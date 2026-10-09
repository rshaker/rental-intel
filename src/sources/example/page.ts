import type { Address, ListingCapture, Plan, Unit } from "../../db/types";
import { emptyCore, rangeOf, rangeSpan } from "../../db/types";
import type { Check, CheckResult, SearchResult, SourcePage } from "../contract";
import { data, imageUrls, text, texts } from "../shared/dom";
import { featuresInWords, orderedFeatures, petFeatures, type FeatureWords } from "../shared/features";
import { factsText } from "../shared/search";
import { ldAddress, ldGeo, ldImages, ldNodeOfType, ldNodes } from "../shared/jsonld";
import { canonicalCheck, markerCheck, ogUrlCheck } from "../shared/checks";
import { availability, clean, idString, list, num, record, soonest, str } from "../shared/values";
import { example } from "./descriptor";
import { EXAMPLE_DETAIL_VERSION, type ExampleDetail } from "./types";

/** Recognising and reading a listings.example page. The synthetic site carries JSON-LD, an inline JSON payload (`script#listing-data`) and a data-attribute-marked DOM, so the example exercises each path. */

const PHOTO_HOSTS = ["photos.listings.example"];
const LD_TYPES = new Set(["ApartmentComplex", "Apartment", "SingleFamilyResidence", "House"]);

/** The site's wording for the shared features (sources/shared/filters.ts), matched against its amenity lines; the pets line is read by the shared pet words. */
const FEATURE_WORDS: FeatureWords = {
    laundryInUnit: /in-unit laundry/i,
    laundryInBuilding: /laundry room/i,
    dishwasher: /dishwasher/i,
    parking: /parking/i,
    gym: /gym|fitness/i,
    pool: /\bpool\b/i,
};

// Checks

/** A JSON-LD node of a listing type; its `identifier` names the listing. */
function jsonLdCheck(doc: Document): CheckResult {
    const node = ldNodeOfType(ldNodes(doc), LD_TYPES);
    const id = node ? idString(node["identifier"]) : null;
    return {
        name: "jsonld",
        matched: node !== null,
        weight: 2,
        matchedId: id,
        detail: node ? `node with identifier=${id ?? "none"}` : "no listing node",
    };
}

/** The site's own payload names the listing. */
function payloadCheck(doc: Document): CheckResult {
    const payload = readPayload(doc);
    const id = payload ? idString(payload["id"]) : null;
    return {
        name: "payload",
        matched: payload !== null,
        weight: 1,
        matchedId: id,
        detail: payload ? `payload id=${id ?? "none"}` : "no payload",
    };
}

const checks: Check[] = [
    jsonLdCheck,
    canonicalCheck(example.urls),
    ogUrlCheck(example.urls),
    payloadCheck,
    markerCheck(["[data-listing]", '[data-field="plans"]', '[data-field="address"]']),
];

// Reading

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
    core.features = orderedFeatures([...featuresInWords(core.amenities, FEATURE_WORDS), ...petFeatures(core.pets ? [core.pets] : [])]);

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

    // The site's word decides the kind; a single unit with no plans of its own is a home either way.
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
        readMethod: payload ? (ld ? "jsonld+payload" : "payload") : ld ? "jsonld+dom" : "dom",
        partial: !payload,
    };
}

// Search pages

/** The result list of a search page: one `[data-result]` per listing inside `main[data-search]`. */
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
        const kind = data(row, "kind");
        results.push({ title, url: href, priceText, factsText: facts, kind: kind === "home" || kind === "building" ? kind : null });
    }
    return results;
}

export const examplePage: SourcePage = { descriptor: example, checks, extract, searchResults };
