import type { ComponentChildren } from "preact";
import type { LinkIds, Listing, ListingCapture, ListingKind, SourceDetail } from "../db/types.js";

/**
 * What a data source (one listing site) provides, in three parts, one per
 * context that loads it:
 *
 *   SourceDescriptor  pure string logic and metadata; loaded by the worker,
 *                     the panel, the manifest (in Node) and the unit tests.
 *   SourcePage        detection and extraction over the live document;
 *                     bundled only into that source's content script.
 *   SourceView        what the panel shows beyond the shared `core`.
 *
 * Adding a source: one folder under src/sources/<id>/ with these three plus
 * `<id>.content.ts`, and one line each in descriptors.ts, worker/sources.ts
 * and panel/sourceViews.ts (the compiler asks for the last two). The shared
 * filter vocabulary (shared/filters.ts) is the one language the panel
 * speaks: `search.filters` says which of it the site's URL can spell, and
 * `extract` writes the features the page states to `core.features`
 * (shared/features.ts). Both mappings live in the source's folder.
 */

/** What a URL says about the page: which listing, and the kind when the URL shape tells. */
export interface UrlRef {
    sourceId: string;
    kind: ListingKind | null;
}

export interface SourceUrls {
    /** The listing a URL names, or null for any other page. Never sufficient alone; the page must confirm (content/detect.ts). */
    parse(url: string): UrlRef | null;
    /** The URL a listing is stored under: tracking and session parameters dropped. */
    canonical(url: string): string;
}

/** One row of a site's search results, as the Search tab lists them. */
export interface SearchResult {
    title: string;
    url: string;
    /** As the site wrote it: "$2,400/mo", "$1,895 – $2,850". */
    priceText: string | null;
    /** "2bd/1ba · 850 sqft", or whatever the site's card says. */
    factsText: string | null;
    /** A home or a building, when the card or its URL says which; null when the site's card does not. The Search tab filters by it. */
    kind: ListingKind | null;
}

/** One filter a site's search takes. A source lists only filters whose URL spelling has been seen on the site. */
export interface SearchFilterField {
    key: string;
    label: string;
    /** `amount`: a number typed in. `minimum`: at least one of `steps`, shown as "2+". `flag`: on or off. `text`: words typed in. */
    kind: "amount" | "minimum" | "flag" | "text";
    title?: string;
    steps?: readonly number[];
    /** Fields of one group share a line of the form. */
    group: string;
}

/** What a form's filters are set to; a filter left alone is absent. */
export type SearchFilters = Readonly<Record<string, number | boolean | string>>;

/** How a site is searched by URL. Pure string logic. */
export interface SourceSearch {
    /** The page to open for a free-text query: the results page when it can be built from the text, else the page whose search box `submitSearch` fills. Null when the text is unusable. */
    searchUrl(query: string): string | null;
    isSearchUrl(url: string): boolean;
    /** The filters the site's search takes, in form order. */
    filters?: readonly SearchFilterField[];
    /** The same search with `filters` applied, given the URL the site settled on for the text. Null when the URL is not a search page. */
    filteredUrl?(url: string, filters: SearchFilters): string | null;
}

export interface SourceDescriptor {
    /** Short, lowercase, stable: stored in every listing row. */
    id: string;
    label: string;
    /** Three capitals for the tag on a card row: "APT". */
    abbreviation: string;
    homepage: string;
    /** A sentence about the site for the Sources tab, when its name does not say enough: the example site says it is invented. */
    about?: string;
    /** Match patterns: `pages` is where the content script runs, `photos` where the worker fetches images from. Both are granted together. */
    hosts: {
        pages: string[];
        photos: string[];
    };
    urls: SourceUrls;
    /** Searching the site from the Search tab. A source without it shows no form there. */
    search?: SourceSearch;
    /** Ids in a listing's `detail` that link it to others on the same site: a building's aliases and the building ids a home carries. */
    linkIds?(detail: SourceDetail): LinkIds;
    /** When the extractor was last checked against the live site, for the Sources tab. */
    verifiedOn: string;
}

// Content script side

/** One check's verdict on the document. */
export interface CheckResult {
    name: string;
    matched: boolean;
    weight: number;
    /** The listing this check says the page is about, when it carries an id. */
    matchedId: string | null;
    detail: string;
}

/** One independent look at the document. Given the listing id the URL names, so a check that must choose between candidates can prefer it. */
export type Check = (doc: Document, urlListingId: string | null) => CheckResult;

/** What submitting a site's own search box came to. */
export interface SubmitResult {
    /** The site has been asked to search: the page that follows will answer. False means try again. */
    submitted: boolean;
    note: string;
}

export interface SourcePage {
    descriptor: SourceDescriptor;
    /** Independent checks that vote on whether this document is one listing, and which; content/detect.ts scores them. */
    checks: Check[];
    /** Reads the page for `listingId`. Null only when the page holds nothing for it; a thin DOM capture beats none. */
    extract(doc: Document, url: string, listingId: string): ListingCapture | null;
    /** The result list of a search page. `[]` is a search page with nothing on it; null is not a search page, or one whose results have not arrived. */
    searchResults?(doc: Document, url: string): SearchResult[] | null;
    /** The next page of this search, when the site splits results over pages and this is not the last. */
    searchNextUrl?(doc: Document, url: string): string | null;
    /** On a page that is not a search page, puts the query into the site's own search box and submits it. Null when this page has no box. */
    submitSearch?(doc: Document, url: string, query: string): Promise<SubmitResult | null>;
    /** Why this page will never become a search page (the site's "not found" page), else null. */
    searchFailure?(doc: Document, url: string): string | null;
    /** The site's check that the visitor is a person, as a sentence for the person at the tab, else null. */
    challenge?(doc: Document, url: string): string | null;
}

// Panel side

/** One line of a card's Details section: a stable key (for the settings switch), a label, a value; null hides the row. */
export type DetailRow = [key: string, label: string, value: ComponentChildren | null];

/** A collapsible section of a card that only this source knows how to fill. Rendered when opened. */
export interface ViewSection {
    key: string;
    label: string;
    render(): ComponentChildren;
}

/** What the panel lends a view while it renders one card. */
export interface ViewContext {
    /** The saved building this listing is a unit of, when there is one. */
    building: Listing | null;
    /** Opens another listing's card. */
    onJump(id: string): void;
}

export interface SourceView {
    descriptor: SourceDescriptor;
    /** Rows appended to the Details section after the shared ones. */
    detailRows(listing: Listing, ctx: ViewContext): DetailRow[];
    sections?(listing: Listing): ViewSection[];
}
