import type { SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, fieldsFor, flag, words, type FilterKey } from "../shared/filters.js";
import { hostMatcher } from "../shared/host.js";

/**
 * URL shapes on apartments.com:
 *
 *   /<property-slug>/<key>/                 a listing; the key is 5-10 lowercase letters and digits
 *   /<city-state>/                          a search (also <city-state-zip>, <neighbourhood-city-state>)
 *   /<city-state>/<filters>/                a filtered search ("min-2-bedrooms", "under-2000")
 *   /<city-state>/2/                        page 2
 *   /houses/<city-state>/                   a search by housing type
 *   /<types>/<place>/<rooms-rent-pets>/<property>/<amenities>/?kw=   every filter at once
 *
 * A neighbourhood page (/austin-tx/downtown/) has the listing shape with a
 * word in the key's place, so `parse` is permissive and the page has to
 * confirm (content/detect.ts). The URL says nothing about the kind.
 */

export const APARTMENTS_ORIGIN = "https://www.apartments.com";

const LISTING_PATH = /^\/([a-z0-9-]+)\/([a-z0-9]{5,10})\/?$/;
/** From one slug segment (the place) to six (types, place, rooms-rent-pets, property, amenities, page). */
const SEARCH_PATH = /^\/(?:[a-z0-9_-]+\/){1,6}$/;

/** Path segments that are searches, not listings, even when they fit the shape. */
const SEARCH_WORDS = new Set(["houses", "condos", "townhomes", "apartments", "rooms", "new", "cheap", "luxury", "furnished", "pet-friendly"]);

/** The housing types the site puts before the place, alone or joined ("apartments-condos"). */
const TYPE_SEGMENT = /^(?:apartments|houses|condos|townhomes)(?:-(?:apartments|houses|condos|townhomes))*$/;

const hostMatches = hostMatcher("apartments.com");

/**
 * Slugs verified against the site's own filter panel and links on
 * 2026-10-04: rooms, rent and pets in one segment after the place
 * (/austin-tx-78701/min-1-bedrooms-1-bathrooms-500-to-2000/), types before
 * the place (/apartments-condos/austin-tx/), the property segment, then a
 * `bit`-ordered amenities segment, with the specials (income restricted) at
 * its head. `bit` is the site's own numbering of each amenity in its panel,
 * which the URL's order follows.
 */
const TYPE_SLUGS: Partial<Record<FilterKey, string>> = {
    typeApartments: "apartments",
    typeHouses: "houses",
    typeCondos: "condos",
    typeTownhomes: "townhomes",
};
const PROPERTY_SLUGS: Partial<Record<FilterKey, string>> = {
    byOwner: "for-rent-by-owner",
};
const SPECIAL_SLUGS: Partial<Record<FilterKey, string>> = {
    incomeRestricted: "low-income",
};
const AMENITY_SLUGS: Partial<Record<FilterKey, { slug: string; bit: number }>> = {
    laundryInUnit: { slug: "washer-dryer", bit: 1 },
    dishwasher: { slug: "dishwasher", bit: 2 },
    airConditioning: { slug: "air-conditioning", bit: 4 },
    furnished: { slug: "furnished", bit: 7 },
    hardwood: { slug: "hardwood-floors", bit: 32 },
    laundryHookups: { slug: "washer_dryer-hookup", bit: 20 },
    utilitiesIncluded: { slug: "utilities-included", bit: 22 },
    laundryInBuilding: { slug: "laundry-facilities", bit: 21 },
    parking: { slug: "parking", bit: 16 },
    elevator: { slug: "elevator", bit: 19 },
    accessible: { slug: "wheelchair-accessible", bit: 17 },
    gym: { slug: "fitness-center", bit: 8 },
    pool: { slug: "pool", bit: 9 },
    controlledAccess: { slug: "controlled-access", bit: 28 },
};

/** One-word filters the site puts alone after the place (/austin-tx/studios/), which would otherwise read as a listing's key. Includes every slug above plus a few seen only as links, 2026-10-04. */
const FILTER_WORDS = new Set(["studios", "luxury", "cheap", "corporate", "duplex", "balcony", "patio", "yard", "fireplace", "office", "lofts", "basement", "garage", "gated", "doorman", "concierge", "clubhouse", "playground", ...Object.values(TYPE_SLUGS), ...Object.values(PROPERTY_SLUGS), ...Object.values(SPECIAL_SLUGS), ...Object.values(AMENITY_SLUGS).map((a) => a!.slug)]);

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
        if (SEARCH_WORDS.has(slug) || FILTER_WORDS.has(key)) return null;
        return { sourceId: key, kind: null };
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

const FIELDS = fieldsFor(["rentMin", "rentMax", "beds", "baths", "typeApartments", "typeHouses", "typeCondos", "typeTownhomes", "smallDogs", "largeDogs", "cats", "laundryInUnit", "laundryHookups", "laundryInBuilding", "dishwasher", "airConditioning", "furnished", "utilitiesIncluded", "hardwood", "parking", "elevator", "accessible", "gym", "pool", "controlledAccess", "incomeRestricted", "byOwner", "keywords"]);

/** The rooms-rent-pets segment, or null when none is set. Dogs collapse to one slug; "small" and "large" are not spelled apart on this site. */
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
    const dogs = flag(filters, "smallDogs") || flag(filters, "largeDogs");
    const cats = flag(filters, "cats");
    if (dogs && cats) parts.push("pet-friendly-dog-and-cat");
    else if (dogs) parts.push("pet-friendly-dog");
    else if (cats) parts.push("pet-friendly-cat");
    return parts.length ? parts.join("-") : null;
}

function slugsOf(slugs: Partial<Record<FilterKey, string>>, filters: SearchFilters): string[] {
    return (Object.entries(slugs) as [FilterKey, string][]).filter(([key]) => flag(filters, key)).map(([, slug]) => slug);
}

export const apartmentsSearch: SourceSearch = {
    /** The site resolves text through its own geography service, so a search opens the home page and the content script submits the site's box (search.ts). */
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

    filters: FIELDS,

    /** Rebuilt from the place alone: old filters and the page number go, a housing type the URL had stays unless the form chooses types. */
    filteredUrl(url: string, filters: SearchFilters): string | null {
        if (!apartmentsSearch.isSearchUrl(url)) return null;
        const segments = new URL(url).pathname.split("/").filter(Boolean);
        const given = TYPE_SEGMENT.test(segments[0] ?? "") && segments.length > 1 ? segments.shift()! : null;
        const place = segments[0];
        if (!place) return null;
        const types = slugsOf(TYPE_SLUGS, filters).join("-") || given;
        const amenities = [
        ...slugsOf(SPECIAL_SLUGS, filters),
        ...(Object.entries(AMENITY_SLUGS) as [FilterKey, { slug: string; bit: number }][])
            .filter(([key]) => flag(filters, key))
            .sort(([, a], [, b]) => a.bit - b.bit)
            .map(([, a]) => a.slug),
    ];
        const path = [types, place, roomsRentPets(filters), slugsOf(PROPERTY_SLUGS, filters).join("-"), amenities.join("-")];
        const keywords = words(filters, "keywords");
        // The site writes a comma-separated list with nothing after the commas and "+" for a space.
        const query = keywords ? `?kw=${keywords.split(/\s*,\s*/).filter(Boolean).map((word) => encodeURIComponent(word).replace(/%20/g, "+")).join("%2C")}` : "";
        return `${APARTMENTS_ORIGIN}/${path.filter(Boolean).join("/")}/${query}`;
    },
};
