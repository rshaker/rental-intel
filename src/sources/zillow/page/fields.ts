import type { Address, CoreFields, Fee, Plan, PropertyType, Unit, UnitStatus } from "../../../db/types";
import { emptyCore, rangeOf, rangeSpan } from "../../../db/types";
import { clean, idString, list, num, record, soonest, str, strings } from "../../shared/values";
import { zillowUrls, ZILLOW_ORIGIN } from "../urls";
import type { ZillowDetail } from "../types";
import type { Node } from "./hydration";

/**
 * Mapping Zillow's payload nodes onto `core` and `ZillowDetail`. Field names
 * verified against captured pages (September 2026): a home's property node
 * and a building's `gdp.building` node. The thin DOM fallbacks at the end
 * are for a page whose payload is missing; prefer fixing the hydration path.
 */

/** Zillow addresses arrive as a structured object or a plain string. */
export function addressFrom(value: unknown, fallback?: unknown): Address {
    const parts = record(value);
    if (parts) {
        const line1 = str(parts["streetAddress"]);
        const city = str(parts["city"]);
        const state = str(parts["state"]);
        const zip = str(parts["zipcode"]);
        // "1800 Lavaca St #503": the unit designation rides in the street line.
        const unit = line1 ? (/#\s*([\w-]+)$/.exec(line1)?.[1] ?? null) : null;
        const text = [line1, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
        return { line1: line1 ? line1.replace(/\s*#\s*[\w-]+$/, "") : null, unit, city, state, zip, text: text ?? str(fallback) };
    }
    const text = str(value) ?? str(fallback);
    return { line1: null, unit: null, city: null, state: null, zip: null, text };
}

/**
 * One URL per photo from a Zillow photo list. Each entry carries a
 * `mixedSources` ladder of the same image at several widths in jpeg and webp;
 * this takes the largest jpeg, else the largest webp, else the entry's own
 * `url`. Deliberately *not* a walk of the whole node: a property's payload also
 * holds its neighbours' photos, and those must never land in its record.
 */
export function photoUrlsFromSources(value: unknown): string[] {
    const urls = new Set<string>();
    for (const item of list(value)) {
        const photo = record(item);
        if (!photo) continue;
        const sources = record(photo["mixedSources"]);
        const jpeg = sources?.["jpeg"];
        const ladder = Array.isArray(jpeg) && jpeg.length ? jpeg : sources?.["webp"];
        let best: { url: string; width: number } | null = null;
        for (const entry of list(ladder)) {
            const source = record(entry);
            const url = str(source?.["url"]);
            const width = num(source?.["width"]) ?? 0;
            if (url && (!best || width > best.width)) best = { url, width };
        }
        const url = best?.url ?? str(photo["url"]);
        if (url) urls.add(url);
    }
    return [...urls];
}

/** "APARTMENT", "TOWNHOUSE", "SINGLE_FAMILY", "CONDO", ["apartment"] → ours. */
export function propertyTypeFrom(value: unknown): PropertyType | null {
    const word = (str(value) ?? strings(value)[0] ?? "").toLowerCase();
    if (!word) return null;
    if (word.includes("town")) return "townhome";
    if (word.includes("condo")) return "condo";
    if (word.includes("single") || word.includes("house") || word.includes("home")) return "house";
    if (word.includes("apartment") || word.includes("multi")) return "apartment";
    return "other";
}

/**
 * When a unit is available, as Zillow states it: "0" for now, a Unix time in
 * milliseconds as a string, or a date string. Anything else is kept as given.
 */
export function availabilityFrom(value: unknown): string | null {
    const text = clean(idString(value));
    if (!text) return null;
    if (text === "0") return "now";
    if (/^\d{11,}$/.test(text)) return new Date(Number(text)).toISOString().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    return text;
}

export function emptyDetail(via: string): ZillowDetail {
    return {
        homeType: null,
        lotId: null,
        buildingKey: null,
        buildingLotId: null,
        buildingName: null,
        buildingUrl: null,
        status: null,
        rentZestimate: null,
        walkScore: null,
        transitScore: null,
        bikeScore: null,
        yearBuilt: null,
        via,
    };
}

function absoluteZillow(path: string | null): string | null {
    if (!path) return null;
    return path.startsWith("/") ? `${ZILLOW_ORIGIN}${path}` : path;
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** Maps a property node onto core and detail. */
export function homeFrom(node: Node): { core: CoreFields; detail: ZillowDetail } {
    // The building a unit belongs to. Every home has one of these, even a
    // detached house (a one-unit "building"); the URL key hides in `bdpUrl`.
    const building = record(node["building"]);
    const bdpUrl = str(building?.["bdpUrl"]) ?? str(node["bdpUrl"]);
    const buildingRef = bdpUrl ? zillowUrls.parse(bdpUrl) : null;

    // Own photos only. `originalPhotos` is uncropped and largest; a walk of
    // the whole node would sweep up the neighbours'.
    const photoUrls = photoUrlsFromSources(node["originalPhotos"]);
    const fallbackPhotos = photoUrlsFromSources(node["responsivePhotos"]);
    const hero = str(node["desktopWebHdpImageLink"]);

    const core = emptyCore();
    core.address = addressFrom(node["address"], node["streetAddress"]);
    core.geo = num(node["latitude"]) !== null && num(node["longitude"]) !== null ? { lat: num(node["latitude"])!, lng: num(node["longitude"])! } : null;
    core.propertyType = propertyTypeFrom(node["homeType"]);
    core.rent = rangeOf(num(node["price"]));
    core.beds = rangeOf(num(node["bedrooms"]) ?? num(node["beds"]));
    core.baths = rangeOf(num(node["bathrooms"]) ?? num(node["baths"]));
    core.sqft = rangeOf(num(node["livingArea"]) ?? num(node["livingAreaValue"]) ?? num(node["sqft"]));
    // A home that is not for rent (off market, for sale) has no availability
    // to speak of, whatever `availabilityDate` still holds.
    const status = str(node["homeStatus"]) ?? str(node["keystoneHomeStatus"]);
    const forRent = status === null || unitStatusFrom(status) === "for-rent";
    core.availableFrom = forRent ? availabilityFrom(node["availabilityDate"]) : null;
    core.photoUrls = photoUrls.length ? photoUrls : fallbackPhotos.length ? fallbackPhotos : hero ? [hero] : [];
    core.description = clean(str(node["description"]));
    core.amenities = amenitiesOf(record(node["resoFacts"]));
    core.pets = petsOf(record(node["resoFacts"]));
    core.fees = feesOf(node["rentalApplicationPriceDetail"], record(node["resoFacts"]));
    const attribution = record(node["attributionInfo"]);
    core.contact.company = str(attribution?.["brokerName"]) ?? str(record(node["listingProvider"])?.["postingWebsiteLinkText"]);
    core.contact.phone = str(attribution?.["agentPhoneNumber"]);

    const detail = emptyDetail("hydration");
    detail.homeType = str(node["homeType"]);
    detail.status = status;
    detail.buildingKey = buildingRef?.kind === "building" ? buildingRef.sourceId : str(node["buildingKey"]);
    detail.buildingLotId = idString(node["buildingId"]) ?? idString(building?.["lotId"]);
    detail.buildingName = str(building?.["buildingName"]) ?? str(node["buildingName"]);
    detail.buildingUrl = absoluteZillow(bdpUrl);
    detail.rentZestimate = num(node["rentZestimate"]);
    detail.yearBuilt = num(node["yearBuilt"]) ?? num(record(node["resoFacts"])?.["yearBuilt"]);
    return { core, detail };
}

/** The amenity-shaped lists in a home's resoFacts, flattened to labels. */
function amenitiesOf(facts: Node | null): string[] {
    if (!facts) return [];
    const out = new Set<string>();
    for (const key of ["appliances", "laundryFeatures", "parkingFeatures", "exteriorFeatures", "interiorFeatures", "communityFeatures", "flooring", "cooling", "heating"]) {
        for (const item of strings(facts[key])) out.add(item);
    }
    return [...out];
}

function petsOf(facts: Node | null): string | null {
    if (!facts) return null;
    const allowed = facts["petsAllowed"];
    const details = strings(facts["petFeatures"] ?? facts["petPolicy"]);
    if (details.length) return details.join(", ");
    return allowed === true ? "Pets allowed" : allowed === false ? "No pets" : null;
}

function feesOf(priceDetail: unknown, facts: Node | null): Fee[] {
    const fees: Fee[] = [];
    const application = num(record(priceDetail)?.["price"]);
    if (application !== null) fees.push({ label: "Application fee", amount: application, text: `$${application}` });
    const deposit = num(facts?.["securityDeposit"]) ?? num(facts?.["depositAmount"]);
    if (deposit !== null) fees.push({ label: "Deposit", amount: deposit, text: `$${deposit}` });
    return fees;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/**
 * Zillow's status word on a home record, as a unit status: `listingType` on
 * a building's ungrouped unit ("FOR_RENT", "OTHER" — verified on a captured
 * small building), `homeStatus` on a home's own page. FOR_RENT is the only
 * value a rental feed produces; the rest are what a home record at a lot
 * can be: for sale (or pending), or off the market (sold, "OTHER", anything
 * unfamiliar). Null when the record carries no status at all.
 */
export function unitStatusFrom(value: unknown): UnitStatus | null {
    const word = (str(value) ?? "").replace(/[\s_-]/g, "").toLowerCase();
    if (!word) return null;
    if (word.includes("rent")) return "for-rent";
    if (word.includes("sale") || word.includes("pending")) return "for-sale";
    return "off-market";
}

/**
 * A unit with a zpid; one without is not a unit Zillow can show, so it is
 * skipped. A `feed` unit comes from a floor plan, which is the property
 * manager's rental feed: every unit in it is for rent, its price is rent and
 * `availableFrom: "0"` means now. An ungrouped unit is a home record Zillow
 * holds at the lot, whatever its state: its `listingType` decides whether
 * the price is rent and the availability means anything. An "OTHER" record
 * keeps a stale `price` or `baseRent` and the `availableFrom: "0"` default
 * from whatever it last was, so none of that is read. A record with no
 * status and no price is off the market; one with a price but no status is
 * unknown, never assumed to be for rent.
 */
function unitFrom(value: unknown, plan: { beds: number | null; baths: number | null }, feed: boolean): Unit | null {
    const unit = record(value);
    const zpid = unit ? idString(unit["zpid"]) : null;
    if (!unit || !zpid) return null;
    const price = num(unit["price"]) ?? num(unit["baseRent"]);
    const stated = unitStatusFrom(unit["listingType"] ?? unit["homeStatus"]);
    const status: UnitStatus | null = feed ? "for-rent" : (stated ?? (price === null ? "off-market" : null));
    const offered = status === "for-rent" || status === null;
    return {
        id: zpid,
        name: str(unit["unitNumber"]),
        beds: num(unit["beds"]) ?? plan.beds,
        baths: num(unit["baths"]) ?? plan.baths,
        sqft: num(unit["sqft"]),
        rent: offered ? price : null,
        availableFrom: offered ? availabilityFrom(unit["availableFrom"]) : null,
        status,
        url: zillowUrls.listing(zpid),
    };
}

function planFrom(value: unknown): Plan | null {
    const plan = record(value);
    if (!plan) return null;
    const beds = num(plan["beds"]);
    const baths = num(plan["baths"]);
    const units = list(plan["units"])
        .map((u) => unitFrom(u, { beds, baths }, true))
        .filter((u): u is Unit => u !== null);
    const sqft = num(plan["sqft"]);
    return {
        id: idString(plan["zpid"]) ?? idString(plan["feedModelId"]),
        name: str(plan["name"]),
        beds,
        baths,
        sqft: units.length ? rangeSpan(units.map((u) => rangeOf(u.sqft))) : rangeOf(sqft),
        rent: { min: num(plan["minPrice"]), max: num(plan["maxPrice"]) },
        availableUnits: Array.isArray(plan["units"]) ? units.length : null,
        units,
    };
}

/**
 * A building's units when Zillow does not group them into floor plans (a
 * small building: `ungroupedUnits` instead of `floorPlans`). Each becomes a
 * plan of its own, named after the unit, so the Plans and Units sections and
 * the unit-to-home relation work the same way. Only a unit for rent counts as
 * available; see unitFrom for why the list holds others.
 */
function plansFromUngrouped(value: unknown): Plan[] {
    return list(value).flatMap((item): Plan[] => {
        const unit = unitFrom(item, { beds: null, baths: null }, false);
        if (!unit) return [];
        return [
            {
                id: unit.id,
                name: unit.name,
                beds: unit.beds,
                baths: unit.baths,
                sqft: rangeOf(unit.sqft),
                rent: rangeOf(unit.rent),
                availableUnits: unit.status === "for-rent" ? 1 : 0,
                units: [unit],
            },
        ];
    });
}

/** For rent, or not said to be otherwise: the units that make up the building's offer. */
function offered(unit: Unit): boolean {
    return unit.status === "for-rent" || unit.status === null;
}

/** The building-level rent range Zillow states per bedroom count, for a building whose plans carry no price. */
function rentFromCosts(node: Node): { min: number | null; max: number | null } {
    const selectors = record(record(node["rentalCostsAndFees"])?.["selectors"]);
    const ranges = list(selectors?.["beds"]).map((item) => {
        const amount = record(record(record(record(record(item)?.["selector"])?.["costs"])?.["baseRent"])?.["amount"]);
        return { min: num(amount?.["min"]), max: num(amount?.["max"]) };
    });
    return rangeSpan(ranges);
}

/** Maps a building node onto core and detail. */
export function buildingFrom(node: Node): { core: CoreFields; detail: ZillowDetail } {
    const grouped = list(node["floorPlans"]).map(planFrom).filter((p): p is Plan => p !== null);
    const plans = grouped.length ? grouped : plansFromUngrouped(node["ungroupedUnits"]);
    const units = plans.flatMap((p) => p.units);
    // The building's offer is its units for rent. A feed unit always is; an
    // ungrouped one may be for sale or off the market and is then left out of
    // the rent, the availability and the count, though it still shapes the
    // beds/baths/sqft ranges (it is a unit of the building either way).
    const onOffer = units.filter(offered);
    const known = units.some((u) => u.status !== null);
    const summaryCount = num(record(node["rentalUnitsSummary"])?.["availableUnitCount"]);
    const amenityDetails = record(node["amenityDetails"]);
    const custom = record(amenityDetails?.["customAmenities"]);

    const core = emptyCore();
    core.name = str(node["buildingName"]);
    core.address = addressFrom(node["address"], node["fullAddress"]);
    core.geo = num(node["latitude"]) !== null && num(node["longitude"]) !== null ? { lat: num(node["latitude"])!, lng: num(node["longitude"])! } : null;
    core.propertyType = propertyTypeFrom(node["homeTypes"]) ?? "apartment";
    core.plans = plans;
    // No building-level range in the payload; it is the floor plans' extent,
    // or the per-bedroom costs Zillow states when the plans carry no price.
    const planRent = rangeSpan(plans.filter((p) => p.units.length === 0 || p.units.some(offered)).map((p) => p.rent));
    core.rent = planRent.min !== null || planRent.max !== null ? planRent : rentFromCosts(node);
    core.beds = rangeSpan(plans.map((p) => rangeOf(p.beds)));
    core.baths = rangeSpan(plans.map((p) => rangeOf(p.baths)));
    core.sqft = rangeSpan(plans.map((p) => p.sqft));
    // Available: the units for rent when the payload says which they are,
    // else Zillow's own count, else every unit listed (a feed lists only
    // available ones).
    core.availableUnits = known ? units.filter((u) => u.status === "for-rent").length : (summaryCount ?? (units.length || null));
    core.availableFrom = soonest(onOffer.map((u) => u.availableFrom));
    // `galleryPhotos` and `photos` are the same set; the gallery ladder is the
    // uncropped, larger one. Floor-plan and amenity photos are left alone.
    const gallery = photoUrlsFromSources(node["galleryPhotos"]);
    core.photoUrls = gallery.length ? gallery : photoUrlsFromSources(node["photos"]);
    core.description = clean(str(node["description"]));
    core.amenities = [...new Set([...strings(custom?.["rawAmenities"]), ...strings(amenityDetails?.["unitFeatures"]), ...strings(node["commonUnitAmenities"])])];
    core.pets = petsOfBuilding(amenityDetails, record(node["detailedPetPolicy"]));
    core.fees = buildingFees(record(node["detailedPetPolicy"]));
    core.contact.phone = str(node["buildingPhoneNumber"]);
    core.contact.company = str(record(node["contactInfo"])?.["agentFullName"]);

    const detail = emptyDetail("hydration");
    detail.homeType = strings(node["homeTypes"])[0] ?? null;
    detail.lotId = idString(node["lotId"]);
    detail.walkScore = num(record(node["walkScore"])?.["walkscore"]) ?? num(node["walkScore"]);
    detail.transitScore = num(record(node["transitScore"])?.["transit_score"]);
    detail.bikeScore = num(record(node["bikeScore"])?.["bikescore"]);
    detail.yearBuilt = num(record(node["buildingAttributes"])?.["yearBuilt"]);
    return { core, detail };
}

function petsOfBuilding(amenityDetails: Node | null, policy: Node | null): string | null {
    const allowed = strings(amenityDetails?.["pets"]);
    const general = clean(str(policy?.["general"]));
    if (allowed.length) return `${allowed.join(", ")} allowed${general ? `. ${general}` : ""}`;
    return general;
}

/** Each pet policy's deposit and monthly fee, labelled by pet type. */
function buildingFees(policy: Node | null): Fee[] {
    const fees: Fee[] = [];
    for (const item of list(policy?.["petPolicies"])) {
        const p = record(item);
        if (!p || p["allowed"] !== true) continue;
        const type = str(p["petType"]) ?? "pet";
        const deposit = num(p["deposit"]);
        const monthly = num(p["monthlyFee"]);
        const oneTime = num(p["oneTimeFee"]);
        if (deposit !== null) fees.push({ label: `${capitalize(type)} deposit`, amount: deposit, text: `$${deposit}` });
        if (monthly !== null) fees.push({ label: `${capitalize(type)} rent`, amount: monthly, text: `$${monthly}/month` });
        if (oneTime !== null) fees.push({ label: `${capitalize(type)} fee`, amount: oneTime, text: `$${oneTime} one time` });
    }
    return fees;
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
