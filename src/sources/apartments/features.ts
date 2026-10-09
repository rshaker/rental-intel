import { text, texts } from "../shared/dom";
import { featuresInWords, orderedFeatures, petFeatures, type FeatureWords } from "../shared/features";
import type { FeatureKey } from "../shared/filters";

/**
 * apartments.com's wording for the shared features (sources/shared/filters.ts):
 * the amenity labels of the 2026-10-08 captures and the site's own filter
 * names. Pets and parking are not amenities on this site; they are tabs
 * under Fees & policies, read apart.
 */

const WORDS: FeatureWords = {
    laundryInUnit: /washer\/dryer(?!.*hookup)|washer (?:and|&) dryer(?!.*hookup)|in[- ]unit (?:laundry|washer)/i,
    laundryHookups: /hookup/i,
    laundryInBuilding: /laundry facilit|laundry room|on-site laundry/i,
    dishwasher: /dishwasher/i,
    airConditioning: /air conditioning/i,
    furnished: /^furnished/i,
    utilitiesIncluded: /utilities included/i,
    hardwood: /hardwood/i,
    parking: /parking|garage|carport/i,
    elevator: /elevator/i,
    accessible: /wheelchair|accessible/i,
    gym: /fitness|\bgym\b/i,
    pool: /\bpool\b(?! table)/i,
    controlledAccess: /controlled access|gated/i,
    incomeRestricted: /income restricted|low income/i,
};

/** The pets tab: `ul.level1 > li` groups on a community, `.feesPoliciesCard` on a house. */
export const PET_PANEL = '[id^="fees-policies-pet"][role="tabpanel"], #petPolicySection, .petPolicyDetails';

/** One heading per pet policy ("Dogs", "Cats Allowed", "No Pets Allowed"); the panel's text when it has no groups. */
function petHeadings(doc: Document): string[] {
    const panel = doc.querySelector(PET_PANEL);
    if (!panel) return [];
    const headings = [...panel.querySelectorAll("ul.level1 > li, .feesPoliciesCard")].map((group) => text(group, ".header-column")).filter((heading): heading is string => heading !== null);
    return headings.length ? headings : texts(panel, ".header-column");
}

/** The parking tab names a kind of parking ("Surface Lot", "Garage"); "Fees not specified" alone is not one. */
function parkingOffered(doc: Document): boolean {
    return texts(doc, '[id^="fees-policies-parking"][role="tabpanel"] .feeName').some((name) => !/not specified/i.test(name));
}

export function featuresFrom(doc: Document, amenities: readonly string[]): FeatureKey[] {
    const parking: FeatureKey[] = parkingOffered(doc) ? ["parking"] : [];
    return orderedFeatures([...petFeatures(petHeadings(doc)), ...featuresInWords(amenities, WORDS), ...parking]);
}
