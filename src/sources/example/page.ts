import type { Address, ListingCapture, Plan, Unit } from "../../db/types";
import { emptyCore, rangeOf, rangeSpan } from "../../db/types";
import type { Probe, SearchResult, Signal, SourcePage } from "../contract";
import { data, imageUrls, text, texts } from "../shared/dom";
import { factsText } from "../shared/search";
import { ldAddress, ldGeo, ldImages, ldNodeOfType, ldNodes } from "../shared/jsonld";
import { canonicalProbe, markerProbe, ogUrlProbe } from "../shared/probes";
import { availability, clean, idString, list, num, rangeText, record, soonest, str } from "../shared/values";
import { example } from "./descriptor";
import { EXAMPLE_DETAIL_VERSION, type ExampleDetail } from "./types";

/**
 * Recognising and reading a listings.example page.
 *
 * The synthetic site carries the three things real sites carry, so the
 * example exercises each path:
 *   - JSON-LD for crawlers: name, address, coordinates, phone, photos.
 *   - An inline JSON payload (<script id="listing-data">) for its own
 *     client-side code: plans and units. Zillow's hydration blob is the
 *     real-world version of this.
 *   - A data-attribute-marked DOM: the fallback, and the amenities.
 */

const PHOTO_HOSTS = ["photos.listings.example"];
const LD_TYPES = new Set(["ApartmentComplex", "Apartment", "SingleFamilyResidence", "House"]);

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** (a) A JSON-LD node of a listing type whose `identifier` is this listing. Worth 2: the server itself said so. */
function jsonLdProbe(doc: Document): Signal {
    const node = ldNodeOfType(ldNodes(doc), LD_TYPES);
    const id = node ? idString(node["identifier"]) : null;
    return {
        name: "jsonld",
        present: node !== null,
        weight: 2,
        claim: id,
        detail: node ? `node with identifier=${id ?? "none"}` : "no listing node",
    };
}

/** (b) The site's own payload names the listing. */
function payloadProbe(doc: Document): Signal {
    const payload = readPayload(doc);
    const id = payload ? idString(payload["id"]) : null;
    return {
        name: "payload",
        present: payload !== null,
        weight: 1,
        claim: id,
        detail: payload ? `payload id=${id ?? "none"}` : "no payload",
    };
}

const probes: Probe[] = [
    jsonLdProbe,
    canonicalProbe(example.urls),
    ogUrlProbe(example.urls),
    payloadProbe,
    markerProbe(["[data-listing]", '[data-field="plans"]', '[data-field="address"]']),
];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readPayload(doc: Document): Record<string, unknown> | null {
    const script = doc.querySelector("script#listing-data");
    if (!script?.textContent) return null;
    try {
        return record(JSON.parse(script.textContent));
    } catch {
        return null;
    }
}

function unitFrom(value: unknown): Unit | null {
    const unit = record(value);
    if (!unit) return null;
    return {
        id: idString(unit["id"]),
        name: str(unit["name"]),
        beds: num(unit["beds"]),
        baths: num(unit["baths"]),
        sqft: num(unit["sqft"]),
        rent: num(unit["rent"]),
        availableFrom: availability(unit["available"]),
        status: "for-rent",
        url: null,
    };
}

function planFrom(value: unknown): Plan | null {
    const plan = record(value);
    if (!plan) return null;
    const units = list(plan["units"]).map(unitFrom).filter((u): u is Unit => u !== null);
    return {
        id: idString(plan["id"]),
        name: str(plan["name"]),
        beds: num(plan["beds"]),
        baths: num(plan["baths"]),
        sqft: rangeSpan(units.map((u) => rangeOf(u.sqft))),
        rent: rangeSpan(units.map((u) => rangeOf(u.rent))),
        availableUnits: units.length,
        units,
    };
}

function addressFromDom(doc: Document): Address | null {
    const line = text(doc, '[data-field="address"]');
    return line ? { line1: null, unit: null, city: null, state: null, zip: null, text: line } : null;
}

function extract(doc: Document, url: string, sourceId: string): ListingCapture | null {
    const nodes = ldNodes(doc);
    const ld = ldNodeOfType(nodes, LD_TYPES);
    const payload = readPayload(doc);
    if (!ld && !payload && !doc.querySelector("[data-listing]")) return null;

    const core = emptyCore();
    core.name = str(ld?.["name"]) ?? text(doc, '[data-field="name"]');
    core.address = ldAddress(ld?.["address"]) ?? addressFromDom(doc) ?? core.address;
    core.geo = ldGeo(ld?.["geo"]);
    core.contact.phone = str(ld?.["telephone"]);
    core.description = text(doc, '[data-field="description"]');
    core.amenities = texts(doc, '[data-field="amenities"] li');
    core.pets = text(doc, '[data-field="pets"]');

    const plans = list(payload?.["plans"]).map(planFrom).filter((p): p is Plan => p !== null);
    const units = plans.flatMap((plan) => plan.units);
    const single = units.length === 1 ? units[0]! : null;
    core.plans = plans;
    core.rent = single ? rangeOf(single.rent) : rangeSpan(plans.map((p) => p.rent));
    core.beds = single ? rangeOf(single.beds) : rangeSpan(plans.map((p) => rangeOf(p.beds)));
    core.baths = single ? rangeOf(single.baths) : rangeSpan(plans.map((p) => rangeOf(p.baths)));
    core.sqft = single ? rangeOf(single.sqft) : rangeSpan(plans.map((p) => p.sqft));
    core.availableUnits = units.length;
    core.availableFrom = soonest(units.map((u) => u.availableFrom));

    const type = str(payload?.["type"]);
    core.propertyType = type === "house" || type === "condo" || type === "townhome" || type === "apartment" ? type : null;
    core.photoUrls = ldImages(ld?.["image"]);
    if (core.photoUrls.length === 0) core.photoUrls = imageUrls(doc, PHOTO_HOSTS);

    // The site's word for what this is decides the kind; a single unit with no
    // plans of its own reads as a home either way.
    const kind = payload?.["kind"] === "home" || (single && plans.length === 1) ? "home" : "building";

    const detail: ExampleDetail = {
        listingId: sourceId,
        rating: num(payload?.["rating"]) ?? num(data(doc.querySelector("[data-rating]"), "rating")),
        unitIds: units.map((u) => u.id).filter((id): id is string => id !== null),
    };

    return {
        sourceId,
        url: example.urls.canonical(url),
        kind,
        core,
        detail: { version: EXAMPLE_DETAIL_VERSION, data: detail },
        via: payload ? (ld ? "jsonld+payload" : "payload") : ld ? "jsonld+dom" : "dom",
        partial: !payload,
        raw: { jsonld: nodes, payload },
    };
}

// ---------------------------------------------------------------------------
// Search pages
// ---------------------------------------------------------------------------

/**
 * The result list of a search page: one `[data-result]` per listing inside
 * `main[data-search]`, each with its link and a price and facts field. Null
 * without the main, which is what every non-search page looks like.
 */
function searchResults(doc: Document, url: string): SearchResult[] | null {
    if (!example.search?.isSearchUrl(url)) return null;
    const main = doc.querySelector("main[data-search]");
    if (!main) return null;
    const results: SearchResult[] = [];
    for (const row of main.querySelectorAll("[data-result]")) {
        const link = row.querySelector<HTMLAnchorElement>("a[href]");
        const title = clean(link?.textContent);
        if (!link || !title) continue;
        const href = new URL(link.getAttribute("href") ?? "", url).href;
        const priceText = text(row, '[data-field="price"]');
        const facts = text(row, '[data-field="facts"]') ?? factsText(num(data(row, "beds")), num(data(row, "baths")), num(data(row, "sqft")));
        results.push({ title, url: href, priceText, price: rangeText(priceText).min, factsText: facts, ref: example.urls.parse(href) });
    }
    return results;
}

export const examplePage: SourcePage = { descriptor: example, probes, extract, searchResults };
