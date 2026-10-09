import { featuresInWords, orderedFeatures, petFeatures, type FeatureWords } from "../../shared/features";
import type { FeatureKey } from "../../shared/filters";
import { list, num, record, str, strings } from "../../shared/values";
import type { Node } from "./hydration";

/**
 * Zillow's wording for the shared features (sources/shared/filters.ts). A
 * home's `resoFacts` and a building's `buildingAttributes` carry typed
 * fields for most of them (booleans, lists of codes), read first; the
 * site's free-text amenity labels are matched after, by one word table.
 * "None" and "Unknown" entries say nothing. Field names from the October
 * 2026 captures.
 */

const WORDS: FeatureWords = {
    laundryInUnit: /washer\/dryer(?!.*hookup)|washer (?:and|&) dryer(?!.*hookup)|in[- ]unit/i,
    laundryHookups: /hookup/i,
    laundryInBuilding: /in[- ]building|shared laundry|laundry room|laundry facilit/i,
    dishwasher: /dishwasher/i,
    airConditioning: /air conditioning|central air/i,
    furnished: /^furnished/i,
    utilitiesIncluded: /utilities included/i,
    hardwood: /hardwood/i,
    parking: /parking|garage|carport/i,
    elevator: /elevator/i,
    accessible: /wheelchair|accessible|\bada\b/i,
    gym: /fitness|\bgym\b/i,
    pool: /\bpool\b(?! table)/i,
    controlledAccess: /controlled access|gated|secured? entry|key ?fob/i,
    incomeRestricted: /income restricted|low income/i,
};

/** A list's entries, less the site's placeholders. */
function known(value: unknown): string[] {
    return strings(value).filter((entry) => !/^(?:none|unknown|n\/a|contact manager)$/i.test(entry));
}

/** Laundry as its own list says: a hookup is not a washer. */
function laundryIn(labels: readonly string[]): FeatureKey[] {
    const out: FeatureKey[] = [];
    for (const label of labels) {
        if (/hookup/i.test(label)) out.push("laundryHookups");
        else if (/in unit|in-unit|\bwasher\b|\bdryer\b|laundry/i.test(label) && !/shared|common|building|room|on.?site/i.test(label)) out.push("laundryInUnit");
        else if (/shared|common|building|room|on.?site/i.test(label)) out.push("laundryInBuilding");
    }
    return out;
}

/** A home's `resoFacts` (MLS-style fields) and its own flags. */
export function homeFeatures(node: Node): FeatureKey[] {
    const facts = record(node["resoFacts"]) ?? {};
    const found: FeatureKey[] = [];
    found.push(...petFeatures(known(facts["allowedPets"])));
    found.push(...laundryIn(known(facts["laundryFeatures"])));
    const appliances = known(facts["appliances"]);
    if (appliances.some((item) => /dishwasher/i.test(item))) found.push("dishwasher");
    if (appliances.some((item) => /\b(?:washer|dryer)\b/i.test(item) && !/hookup/i.test(item))) found.push("laundryInUnit");
    if (facts["hasCooling"] === true || known(facts["cooling"]).length) found.push("airConditioning");
    if (facts["furnished"] === true) found.push("furnished");
    if (known(facts["flooring"]).some((item) => /hardwood/i.test(item))) found.push("hardwood");
    if ([facts["hasGarage"], facts["hasAttachedGarage"], facts["hasCarport"], facts["hasOpenParking"]].includes(true) || (num(facts["parkingCapacity"]) ?? 0) > 0 || known(facts["parkingFeatures"]).length) found.push("parking");
    if (known(facts["accessibilityFeatures"]).length) found.push("accessible");
    if (facts["hasPrivatePool"] === true || known(facts["poolFeatures"]).length) found.push("pool");
    if (node["isIncomeRestricted"] === true) found.push("incomeRestricted");
    const labels = ["communityFeatures", "buildingFeatures", "associationAmenities", "interiorFeatures", "exteriorFeatures", "securityFeatures", "otherFacts"].flatMap((key) => known(facts[key]));
    found.push(...featuresInWords(labels, WORDS));
    return orderedFeatures(found);
}

/** A building's `buildingAttributes`, `amenityDetails` and its own flags. */
export function buildingFeatures(node: Node): FeatureKey[] {
    const attrs = record(node["buildingAttributes"]) ?? {};
    const details = record(node["amenityDetails"]) ?? {};
    const found: FeatureKey[] = [];
    found.push(...petFeatures([...known(details["pets"]), ...known(attrs["petPolicies"])]));
    const appliances = known(attrs["appliances"]);
    if (appliances.some((item) => /dishwasher/i.test(item))) found.push("dishwasher");
    if (appliances.some((item) => /\b(?:washer|dryer)\b/i.test(item) && !/hookup/i.test(item))) found.push("laundryInUnit");
    if (attrs["hasSharedLaundry"] === true) found.push("laundryInBuilding");
    if (known([attrs["airConditioning"]]).length) found.push("airConditioning");
    if (attrs["isFurnished"] === true) found.push("furnished");
    if (known(attrs["utilitiesIncluded"]).length) found.push("utilitiesIncluded");
    if (known(attrs["floorCoverings"]).some((item) => /hardwood/i.test(item))) found.push("hardwood");
    if (known(attrs["parkingTypes"]).length || list(attrs["detailedParkingPolicies"]).length) found.push("parking");
    if (attrs["hasElevator"] === true) found.push("elevator");
    if (attrs["hasDisabledAccess"] === true) found.push("accessible");
    if (known(attrs["communityRooms"]).some((room) => /fitness|gym/i.test(room))) found.push("gym");
    if (attrs["hasSwimmingPool"] === true) found.push("pool");
    if (known(attrs["securityTypes"]).some((kind) => /gated|controlled|key/i.test(kind))) found.push("controlledAccess");
    if (node["isLowIncome"] === true || str(attrs["incomeRestrictions"])) found.push("incomeRestricted");
    const labels = [...known(record(details["customAmenities"])?.["rawAmenities"]), ...known(details["unitFeatures"]), ...known(node["commonUnitAmenities"]), ...known(attrs["customUnitAmenities"])];
    found.push(...featuresInWords(labels, WORDS));
    return orderedFeatures(found);
}
