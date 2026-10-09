import type { SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, fieldsFor, flag, words, type FilterKey } from "../shared/filters.js";
import { hostMatcher } from "../shared/host.js";
import { record } from "../shared/values.js";

/**
 * URL shapes on zillow.com:
 *
 *   /homedetails/<slug>/<zpid>_zpid/      a home: one dwelling with a zpid
 *   /apartments/<region>/<slug>/<key>/    a building
 *   /b/<slug>-<key>/                      the older building shape
 *   /b/building/<lat>,<lng>_ll/           a building named by its coordinates, as a search result links it;
 *                                         the site redirects it to the keyed page (checked 2026-10-07)
 *   /<city-state>/rentals/ and friends    searches
 *   /homes/for_rent/<text>_rb/            a free-text search, redirected to the region's page
 *
 * A building key is a short mixed-case handle (CpRFCG); demanding one capital
 * or digit is what stops /apartments/austin-tx/hyde-park/ reading as one.
 * Homes are checked first: opening a unit from a building page moves the URL
 * to the unit's `_zpid` address, the more specific subject.
 *
 * A coordinate URL's id (`ll:<lat>,<lng>`) is provisional: no page confirms
 * it, since the tab lands on the keyed page. The URL-list loader takes the
 * page the tab lands on.
 */

export const ZILLOW_ORIGIN = "https://www.zillow.com";

const ZPID_URL_PATTERN = /\/(\d+)_zpid/;
const BUILDING_KEY = "(?=[a-z]*[A-Z0-9])([A-Za-z0-9]{5,10})";
const BUILDING_URL_PATTERNS = [new RegExp(`/apartments/(?:[^/?#]+/){1,2}${BUILDING_KEY}/?(?:[?#]|$)`), new RegExp(`/b/[^/?#]*-${BUILDING_KEY}/?(?:[?#]|$)`)];
const COORDINATE_URL_PATTERN = /\/b\/building\/(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)_ll\/?(?:[?#]|$)/;

const hostMatches = hostMatcher("zillow.com");

/** A search page's path: the free-text shape, a region's rentals, or the region browse under /apartments/. */
const SEARCH_PATHS = [/_rb\/?$/, /^\/homes\/for_rent\//, /^\/[a-z0-9-]+\/(?:rentals|apartments|houses|condos|townhomes)\/(?:[^/]+\/)*$/, /^\/apartments\/(?:[a-z0-9-]+\/){1,2}$/];

/** A zpid is all digits; a building key never is. */
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
 * Short keys the site's `filterState` takes, from its own dictionary in
 * `__NEXT_DATA__` (read 2026-10-04); beds, baths, mp, cat, eaa, dish, uti
 * were also seen in URLs the site's own filter panel wrote that day. Types
 * are not a 1:1 flag: choosing any type switches the rest off, and condos
 * share `apco` with apartments (the site's own "Apts/condos" option).
 */
const STATE: Partial<Record<FilterKey, string>> = {
    typeHouses: "sf",
    typeTownhomes: "tow",
    smallDogs: "sdog",
    largeDogs: "ldog",
    cats: "cat",
    laundryInUnit: "lau",
    dishwasher: "dish",
    airConditioning: "ac",
    furnished: "fur",
    utilitiesIncluded: "uti",
    hardwood: "hrdwd",
    parking: "parka",
    elevator: "eaa",
    accessible: "disac",
    gym: "fit",
    pool: "pool",
    controlledAccess: "ca",
    incomeRestricted: "inc",
    byOwner: "frbo",
};
/** Zillow has no flag of its own for an apartment or condo type alone; choosing either writes `apco`. */
const APCO_TYPES: readonly FilterKey[] = ["typeApartments", "typeCondos"];
const TYPE_KEYS: readonly FilterKey[] = [...APCO_TYPES, "typeHouses", "typeTownhomes"];

const FIELDS = fieldsFor(["rentMin", "rentMax", "beds", "baths", ...TYPE_KEYS, ...(Object.keys(STATE) as FilterKey[]), "keywords"]);

/** What the site's own rental URLs always say: for rent and none of the for-sale kinds. `fr` alone was answered with no homes (checked 2026-10-04). */
const RENTALS: Record<string, unknown> = {
    fr: { value: true },
    ...Object.fromEntries(["fsba", "fsbo", "nc", "lsact", "cmsn", "lscmsn", "lszp", "auc", "fore", "mf", "land", "manu"].map((key) => [key, { value: false }])),
};

/**
 * Page `page` of the filtered search at `url`: the same path with the page
 * number on its end and the same `searchQueryState` saying which page. Null
 * when the URL carries no state. Needed because the site's own "next" link
 * leaves the state off, and followed as written is page 2 of the unfiltered
 * search (checked live, 2026-10-04).
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
    /** The site's own text-search shape ("Austin,-TX_rb"), which it redirects to the region's page. */
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

    filters: FIELDS,

    /** The region's page with a `searchQueryState` carrying the filters; a state the URL already has is kept, less its page and the filters the form owns. */
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
        for (const [key, stateKey] of Object.entries(STATE) as [FilterKey, string][]) set(stateKey, flag(filters, key) ? { value: true } : {});
        // Every type is on unless said otherwise; choosing some is saying no to the rest.
        const chosenTypes = TYPE_KEYS.filter((key) => flag(filters, key));
        if (chosenTypes.length) {
            set("apco", chosenTypes.some((key) => APCO_TYPES.includes(key)) ? { value: true } : { value: false });
            set("sf", flag(filters, "typeHouses") ? { value: true } : { value: false });
            set("tow", flag(filters, "typeTownhomes") ? { value: true } : { value: false });
        } else {
            set("apco", {});
            set("sf", {});
            set("tow", {});
        }
        const keywords = words(filters, "keywords");
        set("att", keywords ? { value: keywords } : {});
        parsed.pathname = parsed.pathname.replace(/\/\d+_p\/?$/, "/");
        parsed.hash = "";
        parsed.searchParams.set("searchQueryState", JSON.stringify({ ...state, pagination: {}, filterState }));
        return parsed.href;
    },
};
