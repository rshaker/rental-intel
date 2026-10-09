import type { Address, Fee, ListingCapture, ListingKind, Plan, PropertyType, Unit } from "../../db/types";
import { emptyCore, rangeOf, rangeSpan } from "../../db/types";
import type { Probe, SearchResult, Signal, SourcePage } from "../contract";
import { data, imageUrls, text, texts } from "../shared/dom";
import { ldAddress, ldGeo, ldImages, ldNodeOfType, ldNodes, type LdNode } from "../shared/jsonld";
import { canonicalProbe, markerProbe, ogUrlProbe } from "../shared/probes";
import { availability, clean, list, num, rangeText, record, soonest, str } from "../shared/values";
import { apartments } from "./descriptor";
import { driveSearch, searchFailure } from "./search";
import { APARTMENTS_DETAIL_VERSION, type ApartmentsDetail, type ApartmentsModel } from "./types";

/**
 * Recognising and reading an apartments.com listing page. Verified against
 * captures of 2026-10-08: a community (Marq Uptown, Austin) and a house.
 *
 * The page's model: a *property* (community, house, condo, townhome) with
 * *models* (floor plans) and *units* under each model, none of which has a
 * page of its own. A house or condo is the same page with no grid at all:
 * one price in the name slot and a headline strip.
 *
 * Readers, in order of trust:
 *   1. JSON-LD: the site emits a `Product` + `RealEstateListing` node for
 *      crawlers whose `mainEntity` (an `ApartmentComplex` or a
 *      `SingleFamilyResidence`) holds the name, address, coordinates and
 *      photos; phone and description sit on the outer node.
 *   2. The pricing grid: `.pricingGridItem` per model, `li.unitContainer`
 *      per unit, data attributes and cells both. See `extract` for the map.
 *   3. Named sections: amenities, fees and policies, description, rating.
 */

const PHOTO_HOSTS = ["apartments.com"];
/** The listing's JSON-LD node. The site wraps it as `Product` + `RealEstateListing`, with the place itself under `mainEntity`. */
const LD_TYPES = new Set(["RealEstateListing", "ApartmentComplex", "Apartment", "Residence", "SingleFamilyResidence", "House", "Accommodation", "LodgingBusiness"]);

/** Furniture only a listing page has. The listing id container and the pricing grid are the surest. */
const MARKERS = ["#propertyName", "[data-listingid]", ".pricingGridItem", "#pricingView", ".propertyAddressContainer", "#amenitiesSection"];

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

/** The key a JSON-LD node's `url` names, when it is a listing URL. */
function ldClaim(node: LdNode | null): string | null {
    const url = str(node?.["url"]) ?? str(node?.["@id"]);
    return url ? (apartments.urls.parse(url)?.sourceId ?? null) : null;
}

/** (a) A JSON-LD node of a listing type. Claims the key its `url` carries. */
function jsonLdProbe(doc: Document): Signal {
    const node = ldNodeOfType(ldNodes(doc), LD_TYPES);
    const claim = ldClaim(node);
    return {
        name: "jsonld",
        present: node !== null,
        weight: 2,
        claim,
        detail: node ? `node claims ${claim ?? "nothing"}` : "no listing node",
    };
}

/**
 * (b) The page carries a listing id, which is the site's own id rather than
 * the URL key, so it claims nothing: it says "a listing page", not which.
 */
function listingIdProbe(doc: Document): Signal {
    const id = data(doc.querySelector("[data-listingid]"), "listingid");
    return { name: "listingid", present: id !== null, weight: 1, claim: null, detail: id ? `listing id ${id}` : "no listing id" };
}

const probes: Probe[] = [jsonLdProbe, canonicalProbe(apartments.urls), ogUrlProbe(apartments.urls), listingIdProbe, markerProbe(MARKERS)];

// ---------------------------------------------------------------------------
// Reading the pricing grid
// ---------------------------------------------------------------------------

/** The text of the first match with the site's spoken labels (`.screenReaderOnly`) and tooltips left out. */
function visible(root: ParentNode, selector: string): string | null {
    const el = root.querySelector(selector);
    if (!el) return null;
    const copy = el.cloneNode(true) as Element;
    for (const hidden of copy.querySelectorAll(".screenReaderOnly, .mortar-tooltip")) hidden.remove();
    return clean(copy.textContent);
}

/** "Studio • 1 Bath • 533 Sq Ft • Available Now": the unit's specs as the site writes them for its apply button. */
function specsOf(row: Element): { beds: number | null; baths: number | null; sqft: number | null; available: string | null } {
    const parts = (data(row, "applynow-specs") ?? "")
        .split("•")
        .map((part) => part.trim())
        .filter(Boolean);
    const find = (pattern: RegExp): string | null => parts.find((part) => pattern.test(part)) ?? null;
    const bedsText = find(/bed|studio/i);
    return {
        beds: bedsText === null ? null : /studio/i.test(bedsText) ? 0 : num(bedsText),
        baths: num(find(/bath/i)),
        sqft: num(find(/sq\s*ft/i)),
        available: find(/available/i),
    };
}

/** A bedroom count or range as the site writes it: "Studio", "2 bd", "Studio - 2 bd". */
function bedRange(value: string | null): { min: number | null; max: number | null } {
    if (!value) return { min: null, max: null };
    const range = rangeText(value);
    if (!/studio/i.test(value)) return range;
    return { min: 0, max: range.max ?? 0 };
}

/**
 * One `li.unitContainer` (a unit row) as a Unit. The row's data attributes
 * carry the unit, its key, beds and baths and the base rent; the cells carry
 * the price a person sees (the total monthly price, fees included), the size
 * and the date. The cells win where both exist, since they are what the
 * listing shows.
 */
function unitFrom(row: Element, model: { beds: number | null; baths: number | null }): Unit {
    const specs = specsOf(row);
    const bedsAttr = data(row, "beds");
    return {
        id: data(row, "unitkey") ?? data(row, "rentalkey"),
        name: data(row, "unit") ?? visible(row, ".unitColumn"),
        beds: (bedsAttr === null ? null : num(bedsAttr)) ?? specs.beds ?? model.beds,
        baths: num(data(row, "baths")) ?? specs.baths ?? model.baths,
        sqft: num(data(row, "sqft")) ?? num(visible(row, ".sqftColumn")) ?? specs.sqft,
        rent: rangeText(visible(row, ".pricingColumn")).min ?? num(data(row, "applynow-price")) ?? num(data(row, "maxrent")),
        availableFrom: availability(visible(row, ".dateAvailable") ?? specs.available ?? data(row, "available")),
        status: "for-rent",
        url: null,
    };
}

/**
 * One `.pricingGridItem` (a model, the site's word for a floor plan) with
 * its units: a `.priceGridModelWrapper[data-rentalkey]` naming the model
 * (`[data-modelname]`, `.modelName`), a `.rentLabel`, a details line
 * ("Studio", "1 Bath", "533 Sq Ft") and, below, the unit rows.
 */
function planFrom(item: Element): { plan: Plan; model: ApartmentsModel } {
    const wrapper = item.querySelector(".priceGridModelWrapper, [data-rentalkey]");
    const details = texts(item, ".detailsTextWrapper span, .detailsText span");
    const find = (pattern: RegExp): string | null => details.find((t) => pattern.test(t)) ?? null;
    const bedsText = data(item.querySelector("[data-beds]"), "beds") ?? data(item, "beds") ?? find(/bed|studio/i);
    const beds = bedsText === null ? null : /studio/i.test(bedsText) ? 0 : num(bedsText);
    const baths = num(data(item.querySelector("[data-baths]"), "baths") ?? data(item, "baths") ?? find(/bath/i));
    const units = [...item.querySelectorAll("li.unitContainer, .unitContainer")].map((row) => unitFrom(row, { beds, baths }));
    const id = data(wrapper, "rentalkey") ?? data(item, "model") ?? data(item, "modelid");
    const name = data(item.querySelector("[data-modelname]"), "modelname") ?? text(item, ".modelName") ?? text(item, ".modelLabel");
    const rentLabel = rangeText(visible(item, ".rentLabel") ?? text(item, ".modelRent"));
    const sqftLabel = rangeText(find(/sq\s*ft/i));

    const plan: Plan = {
        id,
        name,
        beds,
        baths,
        sqft: units.length ? rangeSpan(units.map((u) => rangeOf(u.sqft))) : sqftLabel,
        rent: units.length ? rangeSpan(units.map((u) => rangeOf(u.rent))) : rentLabel,
        availableUnits: units.length || null,
        units,
    };
    const model: ApartmentsModel = { id, name, rentalKeys: units.map((u) => u.id).filter((k): k is string => k !== null) };
    return { plan, model };
}

// ---------------------------------------------------------------------------
// Reading the rest of the page
// ---------------------------------------------------------------------------

/**
 * The headline strip under the name. A community's reads rent, beds, baths,
 * size ("$1,415 - $4,625", "Studio - 2 bd", "1 - 2 ba", "418 - 1,527 sq
 * ft"); a house's reads beds, baths, size, availability as bare values
 * ("3", "2", "1,142 sq ft", "Available Aug 8, 2027"), with the price in the
 * name slot ("$3,705"). Each item is told by its words, the bare numbers by
 * their order.
 */
function stripFrom(doc: Document): { rent: Range; beds: Range; baths: Range; sqft: Range; available: string | null } {
    const none = (): Range => ({ min: null, max: null });
    const out = { rent: none(), beds: none(), baths: none(), sqft: none(), available: null as string | null };
    const bare: string[] = [];
    for (const item of texts(doc, ".priceBedRangeInfo .rentInfoDetail, .rentInfoDetail")) {
        if (/\$/.test(item)) out.rent = rangeText(item);
        else if (/sq\s*ft/i.test(item)) out.sqft = rangeText(item);
        else if (/available/i.test(item)) out.available = item;
        else if (/\bbd\b|bed|studio/i.test(item)) out.beds = bedRange(item);
        else if (/\bba\b|bath/i.test(item)) out.baths = rangeText(item);
        else if (/^\d/.test(item)) bare.push(item);
    }
    if (out.beds.min === null && bare[0] !== undefined) out.beds = rangeText(bare[0]);
    if (out.baths.min === null && bare[1] !== undefined) out.baths = rangeText(bare[1]);
    const price = text(doc, "#propertyName");
    if (out.rent.min === null && price && /\$/.test(price)) out.rent = rangeText(price);
    return out;
}

type Range = { min: number | null; max: number | null };

/** "3320 Harmon Ave, Austin, TX 78705" from the address block, whose parts sit in nested spans with the commas as text. */
function addressFromDom(doc: Document): Address | null {
    const container = doc.querySelector(".propertyAddressContainer, .propertyAddress");
    const line = clean(container?.textContent?.replace(/\s*,\s*/g, ", "));
    if (!line) return null;
    const parts = line
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
    const [line1, city, stateZip] = parts;
    const match = stateZip ? /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/.exec(stateZip) : null;
    return { line1: line1 ?? null, unit: null, city: city ?? null, state: match?.[1] ?? null, zip: match?.[2] ?? null, text: parts.join(", ") };
}

function propertyTypeFrom(label: string | null, ldTypes: readonly string[]): PropertyType | null {
    const words = `${label ?? ""} ${ldTypes.join(" ")}`.toLowerCase();
    if (/townho/.test(words)) return "townhome";
    if (/condo/.test(words)) return "condo";
    if (/house|singlefamily/.test(words)) return "house";
    if (/apartment/.test(words)) return "apartment";
    return label ? "other" : null;
}

/** Fee rows under `root`: a `.feeName` (its title holds the full name), the `.feeValue` beside it, and the tooltip's note. */
function feeRows(root: ParentNode): Fee[] {
    const fees: Fee[] = [];
    for (const nameEl of root.querySelectorAll(".feeName")) {
        const row = nameEl.closest(".component-row, .fee-wrapper") ?? nameEl.parentElement;
        if (!row) continue;
        const label = clean(nameEl.getAttribute("title")) ?? clean(nameEl.textContent);
        const value = visible(row, ".feeValue") ?? "";
        const note = text(row, ".mortar-tooltip-inner-text-container");
        // "Fees not specified" is the site's blank, not a fee.
        if (label && !/not specified/i.test(label)) fees.push({ label, amount: num(value), text: value && note ? `${value} (${note})` : value || note || "" });
    }
    return fees;
}

/** Every fee tab but the pets one (that is `pets`), de-duplicated: the site repeats a row across tabs. */
function feesFrom(doc: Document): Fee[] {
    const panels = [...doc.querySelectorAll('#profileV2FeesWrapper [role="tabpanel"], #feesPoliciesSection, .feespolicies')].filter((p) => !/pet/i.test(p.id));
    const rows = panels.length ? panels.flatMap((p) => feeRows(p)) : feeRows(doc);
    const seen = new Set<string>();
    return rows.filter((fee) => {
        const key = `${fee.label}|${fee.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * The pets tab as one line. A community's groups dogs and cats under
 * `ul.level1 > li` headings with fee rows, restrictions and comments; a
 * house's uses `.feesPoliciesCard` with a heading and a row or two.
 */
function petsFrom(doc: Document): string | null {
    const panel = doc.querySelector('[id^="fees-policies-pet"][role="tabpanel"], #petPolicySection, .petPolicyDetails');
    if (!panel) return null;
    const groups = [...panel.querySelectorAll("ul.level1 > li, .feesPoliciesCard")];
    if (groups.length === 0) return clean(panel.textContent);
    const lines = groups.map((group) => {
        const heading = text(group, ".header-column");
        const rows = feeRows(group).map((fee) => (fee.text ? `${fee.label} ${fee.text}` : fee.label));
        const labels = texts(group, ".restrictionsLabel, .policyCommentsLabel");
        const comments = [...group.querySelectorAll(".commentsWrapper")].map((c) => clean(c.textContent)).filter((c): c is string => c !== null);
        const notes = comments.map((comment, i) => (labels[i] ? `${labels[i]!.replace(/:?$/, ":")} ${comment}` : comment));
        const body = [rows.join(", "), ...notes]
            .filter(Boolean)
            .map((piece) => piece.replace(/\.\s*$/, ""))
            .join("; ");
        return [heading, body].filter(Boolean).join(": ");
    });
    return lines.filter(Boolean).join(" · ") || null;
}

/** A management company from its profile link (/pmc/cws-capital-partners/...), when the page names it no other way. */
function companyFrom(doc: Document): string | null {
    const named = text(doc, ".managementCompany, .propertyManagement");
    if (named) return named;
    const href = doc.querySelector('a[href*="/pmc/"]')?.getAttribute("href");
    const slug = href ? /\/pmc\/([^/]+)\//.exec(href)?.[1] : null;
    return slug ? slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") : null;
}

function scoreOf(doc: Document, selector: string): number | null {
    return num(text(doc, selector));
}

/**
 * Verified against captures of 2026-10-08 (playwright/fixtures/
 * apartments-building.html, a community; apartments-house.html, a house):
 *
 *   JSON-LD              Product+RealEstateListing; `mainEntity` (ApartmentComplex or
 *                        SingleFamilyResidence) holds name, address, geo, image; `telephone`
 *                        and `description` sit on the outer node
 *   #propertyName        the name, or on a house the price ("$3,705")
 *   .propertyAddressContainer   the address in spans
 *   .rentInfoDetail      the headline strip (see stripFrom)
 *   #pricingView .pricingGridItem   models and their li.unitContainer rows (see planFrom)
 *   #descriptionSection p, #uniqueFeatures .specInfo
 *   #amenitiesSection .amenityLabel, .specInfo
 *   #profileV2FeesWrapper [role=tabpanel]   fee tabs, the pets one read as a line
 *   .renter-score, .reviewCount
 */
function extract(doc: Document, url: string, sourceId: string): ListingCapture | null {
    const nodes = ldNodes(doc);
    const ld = ldNodeOfType(nodes, LD_TYPES);
    const entity = record(ld?.["mainEntity"]) ?? ld;
    const items = [...doc.querySelectorAll(".pricingGridItem")];
    if (!ld && items.length === 0 && !doc.querySelector("#propertyName")) return null;

    const via: string[] = [];
    if (ld) via.push("jsonld");
    if (items.length || doc.querySelector("#propertyName")) via.push("dom");

    const ldTypes = [...new Set([...(ld ? [ld["@type"]].flat() : []), ...(entity ? [entity["@type"]].flat() : [])].filter((t): t is string => typeof t === "string"))];
    const read = items.map(planFrom);
    const plans = read.map((r) => r.plan);
    const units = plans.flatMap((p) => p.units);
    const strip = stripFrom(doc);

    // A community is a page the site calls a complex, or one with more than
    // one unit or model. A house or condo has one of each, or none listed.
    const kind: ListingKind = ldTypes.includes("ApartmentComplex") || units.length > 1 || plans.length > 1 ? "building" : "home";

    const core = emptyCore();
    const ldName = str(entity?.["name"]) ?? str(ld?.["name"]);
    const domName = text(doc, "#propertyName");
    // A house has no name of its own: the site puts its price in the name slot.
    core.name = kind === "home" ? null : (ldName ?? (domName && !/\$/.test(domName) ? domName : null) ?? text(doc, "h1"));
    core.address = ldAddress(entity?.["address"]) ?? addressFromDom(doc) ?? core.address;
    core.geo = ldGeo(entity?.["geo"]);
    const phone = str(ld?.["telephone"]) ?? str(entity?.["telephone"]) ?? visible(doc, ".phoneNumber") ?? data(doc.querySelector("[data-phone]"), "phone");
    core.contact.phone = phone && phone.replace(/\D/g, "").length >= 7 ? phone : null;
    core.contact.company = companyFrom(doc);
    core.description = str(ld?.["description"]) ?? str(entity?.["description"]) ?? text(doc, "#descriptionSection p, #descriptionSection, .descriptionSection");
    core.amenities = [...new Set(texts(doc, "#amenitiesSection .amenityLabel, #amenitiesSection .specInfo, #uniqueFeatures .specInfo"))];
    core.pets = petsFrom(doc);
    core.fees = feesFrom(doc);

    core.plans = plans;
    if (plans.length) {
        core.rent = rangeSpan(plans.map((p) => p.rent));
        core.beds = rangeSpan(plans.map((p) => rangeOf(p.beds)));
        core.baths = rangeSpan(plans.map((p) => rangeOf(p.baths)));
        core.sqft = rangeSpan(plans.map((p) => p.sqft));
    } else {
        core.rent = strip.rent;
        core.beds = strip.beds;
        core.baths = strip.baths;
        core.sqft = strip.sqft;
    }
    core.availableUnits = units.length || null;
    core.availableFrom = soonest(units.map((u) => u.availableFrom)) ?? availability(strip.available);

    // "Marq Uptown is an apartment community located in…", "2802 Salado St is a house located in…"
    const blurb = text(doc, ".propertyBlurbContent");
    const typeLabel = text(doc, ".propertyType") ?? (blurb ? (/\bis an? ([a-z]+(?: [a-z]+)?) located\b/i.exec(blurb)?.[1] ?? null) : null);
    core.propertyType = propertyTypeFrom(typeLabel, ldTypes);

    core.photoUrls = ldImages(entity?.["image"] ?? ld?.["image"]);
    if (core.photoUrls.length === 0) core.photoUrls = imageUrls(doc, PHOTO_HOSTS).filter((u) => /images1\.apartments\.com|image\.apartments\.com/.test(u));

    const detail: ApartmentsDetail = {
        listingId: data(doc.querySelector("[data-listingid]"), "listingid"),
        via,
        models: read.map((r) => r.model),
        rating: scoreOf(doc, ".renter-score, .reviewRating, [class*='rating'] .ratingValue"),
        reviewCount: num(text(doc, ".reviewCount, [class*='reviewCount']")),
        walkScore: scoreOf(doc, ".walkScore .score, [class*='walkScore'] .score"),
        transitScore: scoreOf(doc, ".transitScore .score, [class*='transitScore'] .score"),
        bikeScore: scoreOf(doc, ".bikeScore .score, [class*='bikeScore'] .score"),
        yearBuilt: num(text(doc, ".yearBuilt, [class*='yearBuilt']")),
        unitCount: num(text(doc, ".unitCount, [class*='unitCount']")),
        propertyTypeLabel: typeLabel,
    };

    return {
        sourceId,
        url: apartments.urls.canonical(url),
        kind,
        core,
        detail: { version: APARTMENTS_DETAIL_VERSION, data: detail },
        via: via.join("+"),
        partial: !ld && items.length === 0,
        raw: { jsonld: nodes, via },
    };
}

// ---------------------------------------------------------------------------
// Search pages
// ---------------------------------------------------------------------------

/**
 * The result list of a search page. Verified against a capture of
 * /austin-tx-78705/ (2026-10-08, playwright/fixtures/
 * apartments-search-results.html): one `article.placard[data-listingid]`
 * per property, in three paid tiers that share the same bones --
 *
 *   header .property-information a.property-link[href]   the listing's page
 *     .property-title                                    "Marq Uptown"
 *     .property-address                                  "3320 Harmon Ave, Austin, TX 78705"
 *   .rentRollup .bedRentBox                              one per bedroom count
 *     .bedTextBox / .priceTextBox                        "Studio" / "$1,415+"
 *
 * -- and a few anchors that are not links at all (`javascript:void(0)` for
 * the favourite button, `a.property-link` without an href in a tooltip),
 * so the page's URL is the first real one, and a placard without one is
 * not a result. Older selectors (`.property-pricing`, `.property-beds`)
 * stay as fallbacks for a tier the capture did not show. The ItemList the
 * page emits for crawlers is the last resort. An empty placard container
 * is an empty answer; a page with neither is not a search page yet.
 */
function searchResults(doc: Document, url: string): SearchResult[] | null {
    if (!apartments.search?.isSearchUrl(url)) return null;
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const placard of doc.querySelectorAll("article.placard, article[data-placard], article[data-listingid]")) {
        const link = placardLink(placard, url);
        const ref = link ? apartments.urls.parse(link) : null;
        if (!link || !ref || seen.has(link)) continue;
        seen.add(link);
        // The row is headed by the address, the one thing every listing has in
        // the same shape; the name, when the site gives one, ends the facts.
        const name = text(placard, ".property-title, .js-placardTitle") ?? placard.querySelector("a.property-link")?.getAttribute("aria-label") ?? text(placard, "a.property-link");
        const address = placardAddress(text(placard, ".property-address") ?? (name && looksLikeAddress(name) ? name : null));
        const title = address ?? name ?? link;
        const rollup = [...placard.querySelectorAll(".bedRentBox")].map((row) => ({ beds: text(row, ".bedTextBox"), price: text(row, ".priceTextBox") })).filter((row) => row.price);
        const priced = rollup.map((row) => ({ ...row, amount: rangeText(row.price).min })).filter((row) => row.amount !== null);
        const cheapest = priced.reduce<(typeof priced)[number] | null>((best, row) => (best === null || row.amount! < best.amount! ? row : best), null);
        const dearest = priced.reduce<(typeof priced)[number] | null>((best, row) => (best === null || row.amount! > best.amount! ? row : best), null);
        const priceText = cheapest && dearest ? (cheapest === dearest ? cheapest.price : `${cheapest.price} – ${dearest.price}`) : text(placard, ".property-pricing, .price-range, .property-rents");
        const bedLabels = rollup.map((row) => row.beds).filter((label): label is string => label !== null);
        const beds = bedLabels.length ? (bedLabels.length === 1 || bedLabels[0] === bedLabels[bedLabels.length - 1] ? bedLabels[0]! : `${bedLabels[0]!} – ${bedLabels[bedLabels.length - 1]!}`) : text(placard, ".property-beds, .bed-range");
        const factsText = [beds, name && name !== title && !looksLikeAddress(name) ? name : null].filter(Boolean).join(" · ") || null;
        results.push({ title, url: link, priceText, price: cheapest?.amount ?? rangeText(priceText).min, factsText, ref });
    }
    if (results.length) return results;

    const itemList = ldNodes(doc).find((node) => [node["@type"]].flat().includes("ItemList"));
    for (const entry of list(itemList?.["itemListElement"])) {
        const item = record(record(entry)?.["item"]) ?? record(entry);
        const link = str(item?.["url"]);
        const title = str(item?.["name"]);
        if (!link || !title || !apartments.urls.parse(link)) continue;
        results.push({ title, url: link, priceText: null, price: null, factsText: null, ref: apartments.urls.parse(link) });
    }
    if (results.length) return results;
    return doc.querySelector("#placardContainer, .placardContainer") || itemList ? [] : null;
}

/**
 * The next page of a search. The site lists 40 placards a page and links
 * the rest from `nav#paging`, whose `a.next` carries the next page's URL
 * (/austin-tx-78701/2/); the document's `link[rel=next]` says the same.
 * The last page has neither. Checked against the live site, 2026-10-03.
 */
function searchNextUrl(doc: Document, url: string): string | null {
    if (!apartments.search?.isSearchUrl(url)) return null;
    const href = doc.querySelector("#paging a.next[href], .paging a.next[href]")?.getAttribute("href") ?? doc.querySelector('link[rel="next"][href]')?.getAttribute("href");
    if (!href) return null;
    try {
        const next = new URL(href, url);
        next.hash = "";
        return next.href !== url && apartments.search.isSearchUrl(next.href) ? next.href : null;
    } catch {
        return null;
    }
}

/** "1800 Lavaca St, Austin, TX 78701": a street, then a city, then a state and zip. */
function looksLikeAddress(value: string): boolean {
    return /\d/.test(value) && /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$/.test(value);
}

/**
 * The address as the site wrote it, less the placeholder it puts on a
 * single-unit listing's address line ("Unit SI ID1607372P", "Unit SI
 * FL2-ID1607387P"): a system id, not a unit. A real unit ("Unit #1",
 * "Unit 2", "APT 101") is part of the address and stays.
 */
export function placardAddress(value: string | null): string | null {
    if (!value) return null;
    return clean(value.replace(/\s+Unit\s+SI(?:\s+[A-Z0-9-]*ID[A-Z0-9-]*)?(?=,|$)/i, ""));
}

/** The listing's page: the first anchor on the placard with a real URL, else its data-url. Never javascript:. */
function placardLink(placard: Element, base: string): string | null {
    const candidates = [...placard.querySelectorAll("a.property-link[href], a[href]")].map((a) => a.getAttribute("href")).concat(data(placard, "url"));
    for (const href of candidates) {
        if (!href || !/^https?:\/\//i.test(href)) continue;
        try {
            const parsed = new URL(href, base);
            parsed.hash = "";
            return parsed.href;
        } catch {
            // Not a URL after all; keep looking.
        }
    }
    return null;
}

export const apartmentsPage: SourcePage = {
    descriptor: apartments,
    probes,
    extract,
    searchResults,
    searchNextUrl,
    driveSearch: (doc, _url, query) => driveSearch(doc, query),
    searchFailure: (doc) => searchFailure(doc),
};
