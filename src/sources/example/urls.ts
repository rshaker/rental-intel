import type { SearchFilters, SourceSearch, SourceUrls, UrlRef } from "../contract.js";
import { amount, fieldsFor, flag, words } from "../shared/filters.js";
import { slugify } from "../shared/slug.js";

/** URL shapes of listings.example: `/l/<id>/` is a listing (the kind is not in the URL), `/search/<city>/` a search page. */

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

    canonical(url: string): string {
        const ref = exampleUrls.parse(url);
        return ref ? `${EXAMPLE_ORIGIN}/l/${ref.sourceId}/` : url;
    },
};

/** The site's search pages: /search/<slug>/. One field of each kind, so the form and the runner are exercised whole. */
export const exampleSearch: SourceSearch = {
    searchUrl(query: string): string | null {
        const slug = slugify(query);
        return slug ? `${EXAMPLE_ORIGIN}/search/${slug}/` : null;
    },

    isSearchUrl(url: string): boolean {
        const parsed = hostMatches(url);
        return parsed !== null && SEARCH_PATH.test(parsed.pathname);
    },

    filters: fieldsFor(["beds", "rentMax", "cats", "laundryInUnit", "keywords"]),

    /** The site takes its filters as query parameters: /search/<slug>/?beds=2&max=2500&cats=1&laundry=1&kw=a+b. */
    filteredUrl(url: string, filters: SearchFilters): string | null {
        const parsed = hostMatches(url);
        if (parsed === null || !SEARCH_PATH.test(parsed.pathname)) return null;
        const beds = amount(filters, "beds");
        const max = amount(filters, "rentMax");
        const keywords = words(filters, "keywords");
        parsed.search = "";
        parsed.hash = "";
        if (beds !== null) parsed.searchParams.set("beds", String(beds));
        if (max !== null) parsed.searchParams.set("max", String(max));
        if (flag(filters, "cats")) parsed.searchParams.set("cats", "1");
        if (flag(filters, "laundryInUnit")) parsed.searchParams.set("laundry", "1");
        if (keywords) parsed.searchParams.set("kw", keywords);
        return parsed.href;
    },
};
