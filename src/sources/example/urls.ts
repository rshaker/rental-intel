import type { SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, BEDS, flag, RENT_MAX } from "../shared/filters.js";
import { slugify } from "../shared/slug.js";

/**
 * URL shapes of the synthetic listing site, listings.example:
 *
 *   https://listings.example/l/<id>/          a listing; the id is 4-12 lowercase alphanumerics
 *   https://listings.example/search/<city>/   a search page, never a listing
 *
 * The listing URL says nothing about the kind: a building and a house share
 * the shape, as they do on apartments.com. Extraction decides.
 */

export const EXAMPLE_ORIGIN = "https://listings.example";

const LISTING_PATH = /^\/l\/([a-z0-9]{4,12})\/?$/;
const SEARCH_PATH = /^\/search\/[a-z0-9-]+\/?$/;

function hostMatches(url: string): URL | null {
    try {
        const parsed = new URL(url);
        return parsed.hostname === "listings.example" ? parsed : null;
    } catch {
        return null;
    }
}

export const exampleUrls: SourceUrls = {
    parse(url: string): UrlRef | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return null;
        }
        if (parsed.hostname !== "listings.example") return null;
        const id = LISTING_PATH.exec(parsed.pathname)?.[1];
        return id ? { sourceId: id, kind: null } : null;
    },

    listing(sourceId: string): string {
        return `${EXAMPLE_ORIGIN}/l/${sourceId}/`;
    },

    canonical(url: string): string {
        const ref = exampleUrls.parse(url);
        return ref ? `${EXAMPLE_ORIGIN}/l/${ref.sourceId}/` : url;
    },
};

/** The site's search pages: /search/<slug>/. */
export const exampleSearch: SourceSearch = {
    searchUrl(query: string): string | null {
        const slug = slugify(query);
        return slug ? `${EXAMPLE_ORIGIN}/search/${slug}/` : null;
    },

    isSearchUrl(url: string): boolean {
        const parsed = hostMatches(url);
        return parsed !== null && SEARCH_PATH.test(parsed.pathname);
    },

    // One of each kind of field, so the form and the runner are exercised whole.
    filters: [RENT_MAX, BEDS, { key: "pets", label: "Pets", kind: "flag", group: "Pets" }],

    /** The site takes its filters as query parameters: /search/<slug>/?beds=2&max=2500&pets=1. */
    filteredUrl(url: string, filters: SearchFilters): string | null {
        const parsed = hostMatches(url);
        if (parsed === null || !SEARCH_PATH.test(parsed.pathname)) return null;
        const beds = amount(filters, "beds");
        const max = amount(filters, "rentMax");
        parsed.search = "";
        parsed.hash = "";
        if (beds !== null) parsed.searchParams.set("beds", String(beds));
        if (max !== null) parsed.searchParams.set("max", String(max));
        if (flag(filters, "pets")) parsed.searchParams.set("pets", "1");
        return parsed.href;
    },
};
