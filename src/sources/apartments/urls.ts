import type { SearchFilterField, SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, BATHS, BEDS, flag, flagField, plainField, RENT_MAX, RENT_MIN, words } from "../shared/filters.js";
import { hostMatcher } from "../shared/host.js";

/**
 * URL shapes on apartments.com:
 *
 *   https://www.apartments.com/<property-slug>/<key>/     a listing
 *   https://www.apartments.com/<city-state>/              a search (also <city-state-zip>, <neighbourhood-city-state>)
 *   https://www.apartments.com/<city-state>/<filters>/    a filtered search ("2-bedrooms", "under-2000")
 *   https://www.apartments.com/<city-state>/2/            page 2 of one
 *   https://www.apartments.com/houses/<city-state>/       a search by type
 *   https://www.apartments.com/<types>/<place>/<rooms-rent-pets>/<property>/<amenities>/?kw=
 *                                                         every filter at once (see FILTERS)
 *
 * The key is a short run of lowercase letters and digits ("kvl7tm9"). A
 * neighbourhood page (/austin-tx/downtown/) has the same two-segment shape
 * with a word in the key's place, and nothing in the URL tells it apart, so
 * `parse` is permissive on purpose: the page has to confirm (detect.ts),
 * and a neighbourhood page never does. Demanding a digit would exclude the
 * one listing in ten whose key happens to have none.
 *
 * The URL says nothing about the kind: a community and a house share the
 * shape. Extraction decides.
 */

export const APARTMENTS_ORIGIN = "https://www.apartments.com";

const LISTING_PATH = /^\/([a-z0-9-]+)\/([a-z0-9]{5,10})\/?$/;
/**
 * A search: from one slug segment (the place) to six (types, place, the
 * rooms-rent-pets filters, the property's, the amenities, a page number).
 * A listing has the two-segment shape; the caller rules those out first.
 */
const SEARCH_PATH = /^\/(?:[a-z0-9_-]+\/){1,6}$/;

/** Path segments that are searches, not listings, even when they fit the shape. */
const SEARCH_WORDS = new Set(["houses", "condos", "townhomes", "apartments", "rooms", "new", "cheap", "luxury", "furnished", "pet-friendly"]);

/**
 * Words the site puts alone after the place that are not filters of the
 * form's (/austin-tx/studios/, /austin-tx/luxury/) and would otherwise
 * read as a listing's key. The form's own one-word filters are added to
 * these below. From the site's own links on a results page, 2026-10-04.
 */
const OTHER_FILTER_WORDS = ["studios", "luxury", "cheap", "corporate"];

/** The housing types the site puts before the place, alone or joined ("apartments-condos"). */
const TYPE_SEGMENT = /^(?:apartments|houses|condos|townhomes)(?:-(?:apartments|houses|condos|townhomes))*$/;

const hostMatches = hostMatcher("apartments.com");

export const apartmentsUrls: SourceUrls = {
    parse(url: string): UrlRef | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        if (!hostMatches(parsed.hostname)) return null;
        const match = LISTING_PATH.exec(parsed.pathname);
        if (!match) return null;
        const [, slug, key] = match as unknown as [string, string, string];
        if (SEARCH_WORDS.has(slug) || filterWords().has(key)) return null;
        return { sourceId: key, kind: null };
    },

    // A listing's page needs its slug, which the key alone does not carry.
    listing(): null {
        return null;
    },

    canonical(url: string): string {
        try {
            const parsed = new URL(url);
            if (!hostMatches(parsed.hostname)) return url;
            parsed.search = "";
            parsed.hash = "";
            parsed.hostname = "www.apartments.com";
            if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
            return parsed.href;
        } catch {
            return url;
        }
    },
};

/**
 * The filters, and how the site spells each in a URL. Every spelling here
 * was seen on the site, 2026-10-04: in two URLs its own filter panel
 * wrote,
 *
 *   /austin-tx-78701/min-1-bedrooms-1-bathrooms-500-to-2000/
 *   /apartments-condos/austin-tx/pet-friendly-dog-and-cat/washer-dryer-laundry-facilities-utilities-included/
 *
 * in the links at the foot of a results page (under-N, balcony, yard,
 * wheelchair-accessible, ev-charging), by loading composed URLs and
 * reading back what the page said it had applied (rooms, rent and pets in
 * one segment; over-N; pet-friendly-cat), and -- every amenity, type and
 * property filter -- by setting them in the site's own "All Filters" panel
 * and reading the URL it went to, for instance
 *
 *   /houses-townhomes/austin-tx/studios-2-bathrooms/for-rent-by-owner-recent-build-duplex-under-50-units/low-income-rent-specials-dishwasher-pool/?kw=fireplace%2Cbike+storage
 *
 * `pet-friendly-dog` alone is the one spelling taken on trust, from its
 * two neighbours. Two of the site's spellings are not its labels: "Den"
 * is `living-room` and "Pavillon" is `clubhouse`.
 *
 * The shape is /<types>/<place>/<rooms-rent-pets>/<property>/<amenities>/,
 * each part left out when it has nothing in it, and keywords in `?kw=`.
 * Within the amenities segment the site takes the words in any order
 * (checked: /pool-garage-parking/ applied all three); they are written in
 * the order of the site's own numbering of them (`bit`, the power of two
 * its panel gives each), which reproduces the URL above.
 *
 * Not offered: the site's star ratings (`?rt=`), move-in date, school and
 * student-housing filters, and "Studio+", which is every home.
 */
const TYPES: readonly (SearchFilterField & { slug: string })[] = [
    { ...flagField("typeApartments", "Apartments", "Type"), slug: "apartments" },
    { ...flagField("typeHouses", "Houses", "Type"), slug: "houses" },
    { ...flagField("typeCondos", "Condos", "Type"), slug: "condos" },
    { ...flagField("typeTownhomes", "Townhomes", "Type"), slug: "townhomes" },
];

/** The property's own filters: the segment before the amenities, in the order the site writes them. */
const PROPERTY: readonly (SearchFilterField & { slug: string })[] = [
    { ...flagField("byOwner", "By owner", "Listing", "For rent by owner"), slug: "for-rent-by-owner" },
    { ...flagField("newBuild", "New build", "Listing", "New construction"), slug: "recent-build" },
    { ...flagField("duplex", "Duplex", "Listing"), slug: "duplex" },
    { ...flagField("smallBuilding", "<50 units", "Listing", "Fewer than 50 units"), slug: "under-50-units" },
];

/** Written at the head of the amenities segment, in this order. */
const SPECIALS: readonly (SearchFilterField & { slug: string })[] = [
    { ...flagField("lowIncome", "Low income", "Listing", "Low income / income restricted"), slug: "low-income" },
    { ...flagField("specials", "Specials", "Listing", "Properties with move-in specials"), slug: "rent-specials" },
];

const amenity = (key: string, label: string, group: string, slug: string, bit: number, title?: string): SearchFilterField & { slug: string; bit: number } => ({ ...flagField(key, label, group, title), slug, bit });

const AMENITIES: readonly (SearchFilterField & { slug: string; bit: number })[] = [
    amenity("washerDryer", "In-unit W/D", "Unit", "washer-dryer", 1, "In-unit washer & dryer"),
    amenity("washerDryerHookups", "W/D hookups", "Unit", "washer_dryer-hookup", 20, "Washer & dryer hookups"),
    amenity("dishwasher", "Dishwasher", "Unit", "dishwasher", 2),
    amenity("airConditioning", "A/C", "Unit", "air-conditioning", 4, "Air conditioning"),
    amenity("furnished", "Furnished", "Unit", "furnished", 7),
    amenity("utilities", "Utilities incl.", "Unit", "utilities-included", 22, "Utilities included"),
    amenity("balcony", "Balcony", "Unit", "balcony", 5),
    amenity("patio", "Patio", "Unit", "patio", 31),
    amenity("yard", "Yard", "Unit", "yard", 35),
    amenity("fireplace", "Fireplace", "Unit", "fireplace", 6),
    amenity("hardwood", "Hardwood", "Unit", "hardwood-floors", 32, "Hardwood floors"),
    amenity("walkInClosets", "Walk-in closets", "Unit", "walk-in-closets", 36),
    amenity("highCeilings", "High ceilings", "Unit", "high-ceilings", 52),
    amenity("den", "Den", "Unit", "living-room", 33),
    amenity("office", "Office", "Unit", "office", 34),
    amenity("lofts", "Loft", "Unit", "lofts", 23),
    amenity("basement", "Basement", "Unit", "basement", 37),
    amenity("laundry", "Laundry", "Building", "laundry-facilities", 21, "Laundry facilities"),
    amenity("parking", "Parking", "Building", "parking", 16),
    amenity("garage", "Garage", "Building", "garage", 30),
    amenity("evCharging", "EV charging", "Building", "ev-charging", 38),
    amenity("elevator", "Elevator", "Building", "elevator", 19),
    amenity("accessible", "Accessible", "Building", "wheelchair-accessible", 17, "Wheelchair access"),
    amenity("gym", "Gym", "Building", "fitness-center", 8, "Fitness center"),
    amenity("pool", "Pool", "Building", "pool", 9),
    amenity("storage", "Storage", "Building", "storage-units", 46, "Storage units"),
    amenity("controlledAccess", "Controlled access", "Building", "controlled-access", 28),
    amenity("gated", "Gated", "Building", "gated", 25, "Gated community"),
    amenity("doorman", "Doorman", "Building", "doorman", 24),
    amenity("concierge", "Concierge", "Building", "concierge", 26),
    amenity("clubhouse", "Clubhouse", "Building", "clubhouse", 27),
    amenity("businessCenter", "Business ctr", "Building", "business-center", 29, "Business center"),
    amenity("playground", "Playground", "Building", "playground", 14),
    amenity("dogPark", "Dog park", "Building", "dog-park", 54),
];

const FILTERS: readonly SearchFilterField[] = [
    RENT_MIN,
    RENT_MAX,
    BEDS,
    BATHS,
    flagField("dogs", "Dogs", "Pets"),
    flagField("cats", "Cats", "Pets"),
    ...TYPES.map(plainField),
    ...PROPERTY.map(plainField),
    ...SPECIALS.map(plainField),
    ...AMENITIES.map(plainField),
    { key: "keywords", label: "Keywords", kind: "text", group: "Keywords", title: "Words in the listing, separated by commas" },
];

let oneWordFilters: Set<string> | null = null;

/** Every filter the site spells as one bare word, which after the place would read as a listing's key. */
function filterWords(): Set<string> {
    oneWordFilters ??= new Set([...OTHER_FILTER_WORDS, ...[...PROPERTY, ...SPECIALS, ...AMENITIES].map((field) => field.slug).filter((slug) => /^[a-z0-9]+$/.test(slug))]);
    return oneWordFilters;
}

const slugsOf = (fields: readonly (SearchFilterField & { slug: string })[], filters: SearchFilters): string[] => fields.filter((field) => flag(filters, field.key)).map((field) => field.slug);

/** The rooms-rent-pets segment, or null when none of those is set. */
function roomsRentPets(filters: SearchFilters): string | null {
    const parts: string[] = [];
    const beds = amount(filters, "beds");
    const baths = amount(filters, "baths");
    const min = amount(filters, "rentMin");
    const max = amount(filters, "rentMax");
    if (beds !== null) parts.push(`min-${beds}-bedrooms`);
    if (baths !== null) parts.push(`${baths}-bathrooms`);
    if (min !== null && max !== null) parts.push(`${Math.min(min, max)}-to-${Math.max(min, max)}`);
    else if (max !== null) parts.push(`under-${max}`);
    else if (min !== null) parts.push(`over-${min}`);
    const dogs = flag(filters, "dogs");
    const cats = flag(filters, "cats");
    if (dogs && cats) parts.push("pet-friendly-dog-and-cat");
    else if (dogs) parts.push("pet-friendly-dog");
    else if (cats) parts.push("pet-friendly-cat");
    return parts.length ? parts.join("-") : null;
}

export const apartmentsSearch: SourceSearch = {
    /**
     * The site resolves text through its own geography service before it
     * builds a URL ("78701" -> /austin-tx-78701/), and nothing in the text
     * says what the URL will be: a guessed slug 404s. So a search opens the
     * home page, and the content script drives the site's own box
     * (search.ts) with the text.
     */
    searchUrl(query: string): string | null {
        return query.trim() ? `${APARTMENTS_ORIGIN}/` : null;
    },

    isSearchUrl(url: string): boolean {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return false;
        }
        if (!hostMatches(parsed.hostname) || apartmentsUrls.parse(url) !== null) return false;
        return SEARCH_PATH.test(parsed.pathname);
    },

    filters: FILTERS,

    /**
     * Rebuilt from the place alone: whatever filters and page number the
     * URL had are dropped, and its housing types kept unless the filters
     * choose their own.
     */
    filteredUrl(url: string, filters: SearchFilters): string | null {
        if (!apartmentsSearch.isSearchUrl(url)) return null;
        const segments = new URL(url).pathname.split("/").filter(Boolean);
        const given = TYPE_SEGMENT.test(segments[0] ?? "") && segments.length > 1 ? segments.shift()! : null;
        const place = segments[0];
        if (!place) return null;
        const types = slugsOf(TYPES, filters).join("-") || given;
        const amenities = [...slugsOf(SPECIALS, filters), ...slugsOf([...AMENITIES].sort((a, b) => a.bit - b.bit), filters)];
        const path = [types, place, roomsRentPets(filters), slugsOf(PROPERTY, filters).join("-"), amenities.join("-")];
        const keywords = words(filters, "keywords");
        // The site writes a comma-separated list with nothing after the commas and "+" for a space.
        const query = keywords ? `?kw=${keywords.split(/\s*,\s*/).filter(Boolean).map((word) => encodeURIComponent(word).replace(/%20/g, "+")).join("%2C")}` : "";
        return `${APARTMENTS_ORIGIN}/${path.filter(Boolean).join("/")}/${query}`;
    },
};
