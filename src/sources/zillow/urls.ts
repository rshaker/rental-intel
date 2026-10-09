import type { SearchFilterField, SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, BATHS, BEDS, flag, flagField, plainField, RENT_MAX, RENT_MIN, words } from "../shared/filters.js";
import { hostMatcher } from "../shared/host.js";
import { record } from "../shared/values.js";

/**
 * URL shapes on zillow.com:
 *
 *   /homedetails/<slug>/<zpid>_zpid/               a home: one dwelling with a zpid
 *   /apartments/<region>/<slug>/<key>/             a building (multi-unit community)
 *   /b/<slug>-<key>/                               the older building shape
 *   /b/building/<lat>,<lng>_ll/                    a building named by its coordinates, as a
 *                                                  search result links it; the site redirects
 *                                                  it to the keyed page (checked 2026-10-07)
 *   /<city-state>/rentals/ and friends             searches
 *   /homes/for_rent/<text>_rb/                     a free-text search, which the site
 *                                                  redirects to the region's page
 *
 * A building key is a short mixed-case handle (CpRFCG, Cghn8g). Zillow's
 * slugs are all lowercase, so demanding one capital or digit is what stops
 * /apartments/austin-tx/hyde-park/ from reading as a building.
 *
 * Homes are checked first on purpose: opening a unit from a building page
 * moves the URL to that unit's `_zpid` address, and the unit is the more
 * specific subject. Here the URL does say the kind, so `parse` fills it in.
 *
 * A coordinate URL's id (`ll:<lat>,<lng>`) is provisional: no page ever
 * confirms it, since the tab lands on the keyed page. It exists so a list
 * of search results loads whole; the loader takes the page the tab lands on
 * (panel/bulk/bulkLoad.ts).
 */

export const ZILLOW_ORIGIN = "https://www.zillow.com";

const ZPID_URL_PATTERN = /\/(\d+)_zpid/;
const BUILDING_KEY = "(?=[a-z]*[A-Z0-9])([A-Za-z0-9]{5,10})";
const BUILDING_URL_PATTERNS = [
    new RegExp(`/apartments/(?:[^/?#]+/){1,2}${BUILDING_KEY}/?(?:[?#]|$)`),
    new RegExp(`/b/[^/?#]*-${BUILDING_KEY}/?(?:[?#]|$)`),
];
const COORDINATE_URL_PATTERN = /\/b\/building\/(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)_ll\/?(?:[?#]|$)/;

const hostMatches = hostMatcher("zillow.com");

/**
 * A search page's path: the free-text shape, a region's rentals and its
 * cousins (with or without a page number), or the region browse under
 * /apartments/ that has no building key. A listing URL never matches: the
 * caller rules those out first.
 */
const SEARCH_PATHS = [/_rb\/?$/, /^\/homes\/for_rent\//, /^\/[a-z0-9-]+\/(?:rentals|apartments|houses|condos|townhomes)\/(?:[^/]+\/)*$/, /^\/apartments\/(?:[a-z0-9-]+\/){1,2}$/];

/** A zpid is all digits; a building key never is. What kind of thing a Zillow id names. */
export function kindOfZillowId(sourceId: string): "home" | "building" {
    return /^\d+$/.test(sourceId) ? "home" : "building";
}

export const zillowUrls: SourceUrls = {
    parse(url: string): UrlRef | null {
        let parsed: URL;
        try {
            parsed = new URL(url, ZILLOW_ORIGIN);
        } catch {
            return null;
        }
        if (!hostMatches(parsed.hostname)) return null;
        const path = parsed.pathname + parsed.search + parsed.hash;
        const zpid = ZPID_URL_PATTERN.exec(path)?.[1];
        if (zpid) return { sourceId: zpid, kind: "home" };
        for (const pattern of BUILDING_URL_PATTERNS) {
            const key = pattern.exec(path)?.[1];
            if (key) return { sourceId: key, kind: "building" };
        }
        const coordinates = COORDINATE_URL_PATTERN.exec(path)?.[1];
        if (coordinates) return { sourceId: `ll:${coordinates}`, kind: "building" };
        return null;
    },

    listing(sourceId: string): string | null {
        // A home's page needs only its zpid; a building's needs its slug too.
        return kindOfZillowId(sourceId) === "home" ? `${ZILLOW_ORIGIN}/homedetails/${sourceId}_zpid/` : null;
    },

    canonical(url: string): string {
        try {
            const parsed = new URL(url);
            if (!hostMatches(parsed.hostname)) return url;
            parsed.search = "";
            parsed.hash = "";
            parsed.hostname = "www.zillow.com";
            return parsed.href;
        } catch {
            return url;
        }
    },
};

/**
 * The filters, and how the site spells each. A filtered Zillow search is
 * its region's page with one query parameter, `searchQueryState`: JSON
 * whose `filterState` holds a short key per filter.
 *
 * The short keys are the site's own: every search page carries its filter
 * dictionary in `__NEXT_DATA__` (`searchPageState.filterDefinitions`: an
 * id, a `shortId`, a label and a type for each), read 2026-10-04. Ten of
 * them were also seen in URLs the site's filter panel wrote that day
 * (beds, baths, mp, sqft, cat, eaa, dish, uti, sf, tow) and answered a
 * fresh load with the filtered list. The rest are from the dictionary
 * alone: the site met the one load that would have checked a batch of
 * them with its bot check.
 *
 * Booleans are `{value: true}`, ranges `{min, max}`, keywords
 * `{value: "text"}`. The home types default to on, so choosing some means
 * saying no to the others.
 *
 * Not offered: days on Zillow, move-in date, commute time, schools and
 * the 55+ switch, which are not on/off or a number.
 */
const flagOf = (key: string, label: string, group: string, state: string, title?: string): SearchFilterField & { state: string } => ({ ...flagField(key, label, group, title), state });

const TYPES: readonly (SearchFilterField & { state: string })[] = [
    flagOf("typeApartments", "Apts/condos", "Type", "apco", "Apartments, condos and co-ops"),
    flagOf("typeHouses", "Houses", "Type", "sf"),
    flagOf("typeTownhomes", "Townhomes", "Type", "tow"),
];

const FLAGS: readonly (SearchFilterField & { state: string })[] = [
    flagOf("smallDogs", "Small dogs", "Pets", "sdog"),
    flagOf("largeDogs", "Large dogs", "Pets", "ldog"),
    flagOf("cats", "Cats", "Pets", "cat"),
    flagOf("byOwner", "By owner", "Listing", "frbo", "For rent by owner"),
    flagOf("community", "Apt community", "Listing", "fmfb", "Apartment community"),
    flagOf("specials", "Specials", "Listing", "promo", "Listings with move-in offers"),
    flagOf("shortTerm", "Short lease", "Listing", "stl", "Short term lease available"),
    flagOf("lowIncome", "Low income", "Listing", "inc", "Income restricted"),
    flagOf("applications", "Zillow apps", "Listing", "app", "Accepts Zillow applications"),
    flagOf("tour3d", "3D tour", "Listing", "3d"),
    flagOf("laundry", "In-unit laundry", "Unit", "lau"),
    flagOf("dishwasher", "Dishwasher", "Unit", "dish"),
    flagOf("airConditioning", "A/C", "Unit", "ac", "Air conditioning"),
    flagOf("furnished", "Furnished", "Unit", "fur"),
    flagOf("utilities", "Utilities incl.", "Unit", "uti", "Utilities included"),
    flagOf("hardwood", "Hardwood", "Unit", "hrdwd", "Hardwood floors"),
    flagOf("outdoor", "Outdoor space", "Unit", "os"),
    flagOf("internet", "Fast internet", "Unit", "hsia", "High speed internet"),
    flagOf("parking", "Parking", "Building", "parka", "On-site parking"),
    flagOf("elevator", "Elevator", "Building", "eaa"),
    flagOf("accessible", "Accessible", "Building", "disac", "Disabled access"),
    flagOf("gym", "Gym", "Building", "fit", "Fitness center"),
    flagOf("pool", "Pool", "Building", "pool"),
    flagOf("controlledAccess", "Controlled access", "Building", "ca"),
    flagOf("waterfront", "Waterfront", "Building", "wat"),
    flagOf("viewCity", "City", "View", "cityv"),
    flagOf("viewMountain", "Mountain", "View", "mouv"),
    flagOf("viewPark", "Park", "View", "parkv"),
    flagOf("viewWater", "Water", "View", "watv"),
];

const FILTERS: readonly SearchFilterField[] = [
    RENT_MIN,
    RENT_MAX,
    BEDS,
    BATHS,
    { key: "sqftMin", label: "Min", kind: "amount", group: "Sq ft" },
    { key: "sqftMax", label: "Max", kind: "amount", group: "Sq ft" },
    ...FLAGS.filter((field) => field.group === "Pets").map(plainField),
    ...TYPES.map(plainField),
    ...FLAGS.filter((field) => field.group !== "Pets").map(plainField),
    { key: "keywords", label: "Keywords", kind: "text", group: "Keywords", title: "Words in the listing" },
];

/**
 * What the site's own rental URLs always say: for rent, and none of the
 * for-sale kinds, nor the three home types its rentals search leaves out.
 * Not optional: the same URL with `fr` alone was answered with no homes at
 * all (checked on the live site, 2026-10-04).
 */
const RENTALS: Record<string, unknown> = {
    fr: { value: true },
    ...Object.fromEntries(["fsba", "fsbo", "nc", "lsact", "cmsn", "lscmsn", "lszp", "auc", "fore", "mf", "land", "manu"].map((key) => [key, { value: false }])),
};

/**
 * Page `page` of the filtered search at `url`: the same path with the page
 * number on its end, and the same `searchQueryState` saying which page.
 * Null when the URL carries no state, or one that does not parse; such a
 * search has nothing a page link would lose.
 *
 * Needed because the site's own "Next page" link leaves the state off
 * (/austin-tx-78701/rentals/2_p/, and with the home type gone from the
 * path too): the page pages in place and never loads that link. Followed
 * as written it is page 2 of the unfiltered search. A fresh load of the
 * URL built here is answered with the filtered page 2 (checked live,
 * 2026-10-04).
 */
export function zillowPageUrl(url: string, page: number): string | null {
    let parsed: URL;
    let state: Record<string, unknown> | null;
    try {
        parsed = new URL(url, ZILLOW_ORIGIN);
        state = record(JSON.parse(parsed.searchParams.get("searchQueryState") ?? "null"));
    } catch {
        return null;
    }
    if (!state || !Number.isInteger(page) || page < 1) return null;
    const base = parsed.pathname.replace(/\/\d+_p\/?$/, "/").replace(/\/?$/, "/");
    parsed.pathname = page > 1 ? `${base}${page}_p/` : base;
    parsed.hash = "";
    parsed.searchParams.set("searchQueryState", JSON.stringify({ ...state, pagination: page > 1 ? { currentPage: page } : {} }));
    return parsed.href;
}

export const zillowSearch: SourceSearch = {
    /**
     * The site's own text-search shape, the one its search box produces:
     * spaces become hyphens and commas stay ("Austin,-TX_rb"). The site
     * answers with a redirect to the region's page.
     */
    searchUrl(query: string): string | null {
        const text = query.trim().replace(/\s+/g, "-");
        if (!text) return null;
        return `${ZILLOW_ORIGIN}/homes/for_rent/${encodeURIComponent(text).replace(/%2C/gi, ",")}_rb/`;
    },

    isSearchUrl(url: string): boolean {
        let parsed: URL;
        try {
            parsed = new URL(url, ZILLOW_ORIGIN);
        } catch {
            return false;
        }
        if (!hostMatches(parsed.hostname) || zillowUrls.parse(url) !== null) return false;
        if (parsed.searchParams.has("searchQueryState")) return true;
        return SEARCH_PATHS.some((pattern) => pattern.test(parsed.pathname));
    },

    filters: FILTERS,

    /**
     * The region's page with a `searchQueryState` carrying the filters.
     * The path names the region, and the site fills in the map from it, so
     * a URL with no state gets only a `filterState`; one that has a state
     * (the map, the region, a sort) keeps it, less its page number and any
     * filter the form now sets differently.
     */
    filteredUrl(url: string, filters: SearchFilters): string | null {
        if (!zillowSearch.isSearchUrl(url)) return null;
        const parsed = new URL(url, ZILLOW_ORIGIN);
        let state: Record<string, unknown> = {};
        try {
            state = record(JSON.parse(parsed.searchParams.get("searchQueryState") ?? "{}")) ?? {};
        } catch {
            // A state that does not parse is replaced.
        }
        const filterState: Record<string, unknown> = { ...RENTALS, ...(record(state["filterState"]) ?? {}) };
        const range = (min: number | null, max: number | null): Record<string, number> => ({ ...(min !== null ? { min } : {}), ...(max !== null ? { max } : {}) });
        const set = (key: string, value: Record<string, unknown>): void => {
            if (Object.keys(value).length) filterState[key] = value;
            else delete filterState[key];
        };
        set("beds", range(amount(filters, "beds"), null));
        set("baths", range(amount(filters, "baths"), null));
        const rentMin = amount(filters, "rentMin");
        const rentMax = amount(filters, "rentMax");
        set("mp", rentMin !== null && rentMax !== null ? range(Math.min(rentMin, rentMax), Math.max(rentMin, rentMax)) : range(rentMin, rentMax));
        const sqftMin = amount(filters, "sqftMin");
        const sqftMax = amount(filters, "sqftMax");
        set("sqft", sqftMin !== null && sqftMax !== null ? range(Math.min(sqftMin, sqftMax), Math.max(sqftMin, sqftMax)) : range(sqftMin, sqftMax));
        for (const field of FLAGS) set(field.state, flag(filters, field.key) ? { value: true } : {});
        // Every type is on unless said otherwise, so choosing some is saying no to the rest.
        const chosen = TYPES.some((field) => flag(filters, field.key));
        for (const field of TYPES) set(field.state, chosen && !flag(filters, field.key) ? { value: false } : {});
        const keywords = words(filters, "keywords");
        set("att", keywords ? { value: keywords } : {});
        parsed.pathname = parsed.pathname.replace(/\/\d+_p\/?$/, "/");
        parsed.hash = "";
        parsed.searchParams.set("searchQueryState", JSON.stringify({ ...state, pagination: {}, filterState }));
        return parsed.href;
    },
};
