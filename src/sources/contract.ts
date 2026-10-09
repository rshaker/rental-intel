import type { Listing, ListingCapture, ListingKind, RelationFields, SourceDetail } from "../db/types.js";

/**
 * What a data source -- one listing site -- provides. A source is three
 * objects, one per context that may see it:
 *
 *   SourceDescriptor  pure string logic and metadata. Imported by the worker,
 *                     the panel, the manifest generator and the unit tests.
 *                     Must not touch the DOM, the database, or Vite's
 *                     import.meta.env: manifest.config.ts loads it in Node.
 *   SourcePage        how to recognise and read the site's pages. Imported
 *                     only by that source's content script, so no site's
 *                     extractor is ever bundled into another's, and nothing
 *                     with a database dependency can reach a content script.
 *   SourceView        what the panel shows beyond the shared `core` fields.
 *                     Imported only by the panel.
 *
 * Adding a source: one folder under src/sources/<id>/ with these three, an
 * `<id>.content.ts` entry that calls runContentScript(page) (the basename
 * must be unique across sources: the bundler names chunks by it), and one
 * line each in descriptors.ts, scripts.ts and views.ts. The compiler insists
 * on the last two: both maps are keyed by every source id.
 */

/** What a URL says about the page: which listing, and -- when the URL shape tells -- what kind. */
export interface UrlRef {
    sourceId: string;
    /** Null when the URL alone cannot tell a home from a building; extraction decides. */
    kind: ListingKind | null;
}

export interface SourceUrls {
    /** The listing a URL names, or null for any other page on the site. Pure string logic; never sufficient on its own, see detect.ts. */
    parse(url: string): UrlRef | null;
    /** A listing's page from its id, when the site's URLs can be built that way. */
    listing(sourceId: string): string | null;
    /** The URL the listing is stored under: tracking and session parameters dropped. */
    canonical(url: string): string;
}

/** One row of a site's search results, as the panel's Search tab lists them. Link-only. */
export interface SearchResult {
    title: string;
    url: string;
    /** As the site wrote it: "$2,400/mo", "$1,895 – $2,850". */
    priceText: string | null;
    /** The headline number, when the site gives one. */
    price: number | null;
    /** "2bd/1ba · 850 sqft", or whatever the site's card says. */
    factsText: string | null;
    /** What the URL says, when it names a listing; null for a URL the source does not recognise. */
    ref: UrlRef | null;
}

/**
 * One filter a site's search takes, as its form on the Search tab offers
 * it. A source lists only filters whose URL spelling has been seen on the
 * site: a guessed one lands on the site's "not found" page.
 */
export interface SearchFilterField {
    /** Stable within the source: what the value is stored and passed under. */
    key: string;
    label: string;
    /** `amount`: a number typed in. `least`: at least one of `steps`, shown as "2+". `flag`: on or off. `text`: words typed in. */
    kind: "amount" | "least" | "flag" | "text";
    /** What the label is short for, when it is ("A/C"): shown on hover. */
    title?: string;
    steps?: readonly number[];
    /** Fields of one group share a line of the form, under this name. */
    group: string;
}

/** What a form's filters are set to. A filter left alone is absent. */
export type SearchFilters = Readonly<Record<string, number | boolean | string>>;

/** How a site is searched by URL. Pure string logic, in urls.ts beside SourceUrls. */
export interface SourceSearch {
    /**
     * The page to open for a free-text query: the site's results page when
     * its URL can be built from the text, else the page whose search box
     * the source's `driveSearch` fills. Null when the text is unusable.
     */
    searchUrl(query: string): string | null;
    /** Whether a URL is one of the site's search pages. The reader bails cheaply on anything else. */
    isSearchUrl(url: string): boolean;
    /** The filters the site's search takes, in the order the form shows them. */
    filters?: readonly SearchFilterField[];
    /**
     * The same search with the filters applied: given the URL of a search
     * page -- the one the site settled on for the text -- the URL of that
     * place's results under `filters`, replacing any the URL already had.
     * Null when the URL is not one of the site's search pages.
     */
    filteredUrl?(url: string, filters: SearchFilters): string | null;
}

export interface SourceDescriptor {
    /** Short, lowercase, stable: it is stored in every listing row. */
    id: string;
    /** As shown to the user: "Apartments.com". */
    label: string;
    /** Three capitals for the tag on a card row, where the label is too long: "APT". */
    code: string;
    homepage: string;
    /**
     * Match patterns. `pages` is where the content script runs and what the
     * URL-list loader accepts; `photos` is where the worker fetches images
     * from. Both are requested from the user, together, when the source is
     * enabled.
     */
    hosts: {
        pages: string[];
        photos: string[];
    };
    urls: SourceUrls;
    /** Searching the site from the panel's Search tab. A source without it shows no form there. */
    search?: SourceSearch;
    /**
     * Ids in a listing's `detail` that relate it to others on the same site
     * beyond its own `sourceId`: the ids a building answers to (a lot id)
     * and the ids a home gives for the building it is in. Pure: the worker
     * reads it at save time and the schema upgrade once. See db/relations.ts.
     */
    relations?(detail: SourceDetail): RelationFields;
    /** When the extractor was last checked against the live site, for the Sources tab. */
    verifiedOn: string;
}

// ---------------------------------------------------------------------------
// Content script side
// ---------------------------------------------------------------------------

export interface Signal {
    /** Short, for the one log line emitted when detection times out: "jsonld", "canonical", … */
    name: string;
    present: boolean;
    /** Contributed to the score only when `present`. */
    weight: number;
    /** The listing this signal says the page is about, when it carries an id. */
    claim: string | null;
    /** Human-readable, for the same log line. */
    detail: string;
}

/**
 * One independent look at the document. Given the URL's subject so a probe
 * that must choose between several candidates (a payload with a "similar
 * homes" carousel) can prefer the one the URL names.
 */
export type Probe = (doc: Document, urlSubject: string | null) => Signal;

/** What driving a site's own search box came to. */
export interface DriveResult {
    /** The site has been asked to search: the page that follows will answer. False means try again. */
    asked: boolean;
    /** What was done, or what stood in the way, for the activity log. */
    note: string;
}

export interface SourcePage {
    descriptor: SourceDescriptor;
    /**
     * Independent signals that vote on whether this document really is one
     * listing, and which. detect.ts scores them; see CONFIRM_SCORE there for
     * how the weights are meant to add up.
     */
    probes: Probe[];
    /**
     * Reads the page for `sourceId`, which detection has settled on. Returns
     * null only when the page holds nothing at all for it; a thin capture
     * from a DOM fallback is better than none, because the user asked.
     */
    extract(doc: Document, url: string, sourceId: string): ListingCapture | null;
    /**
     * The result list of a search page. `[]` is a search page with nothing
     * on it, a final answer; null is not a search page, or one whose results
     * have not arrived yet, so the panel asks again.
     */
    searchResults?(doc: Document, url: string): SearchResult[] | null;
    /**
     * The next page of this search, when the site splits its results over
     * pages and this is not the last: the URL the site's own "next" link
     * goes to. Asked only of a page `searchResults` has read. Null on the
     * last page, and for a site that lists everything on one.
     */
    searchNextUrl?(doc: Document, url: string): string | null;
    /**
     * On a page of the site that is not a search page -- the one `searchUrl`
     * opened -- puts the query into the site's own search box and submits
     * it, for a site that resolves text to a URL itself. Null when this
     * page has no box; otherwise what was done, and whether the site has
     * been asked (when it has not, the panel asks for another go).
     */
    driveSearch?(doc: Document, url: string, query: string): Promise<DriveResult | null>;
    /**
     * Why this page will never become a search page, when it never will:
     * the site's "not found" page. Null otherwise. Lets a run end at once
     * with a reason instead of waiting on the person at the tab.
     */
    searchFailure?(doc: Document, url: string): string | null;
    /**
     * The site's check that the visitor is a person, when this page is one,
     * as a sentence for the person at the tab: the capture row, the Search
     * tab and the Load URLs dialog all show it and wait, since the page that
     * follows the answer is the one they want. Null otherwise.
     */
    challenge?(doc: Document, url: string): string | null;
}

// ---------------------------------------------------------------------------
// Panel side
// ---------------------------------------------------------------------------

/** One line of a card's Details section: a stable key (for the settings switch), a label, a value. */
export type DetailRow = [key: string, label: string, value: string | Node | null];

/** A collapsible section of a card that only this source knows how to fill. */
export interface ViewSection {
    key: string;
    label: string;
    /** Called when the section is opened. Nothing is built for closed sections. */
    render(): HTMLElement;
}

/** What the panel lends a view while it renders one card. */
export interface ViewContext {
    /** The saved building this listing is a unit of, when the panel found one. */
    building: Listing | null;
    /** A link-styled button that opens another listing's card. */
    cardLink(target: Listing): HTMLElement;
    /**
     * A web-page icon that opens `href` in the tab beside the panel, the way
     * every other web link in the panel does (so Back returns). `describe`
     * names what it opens, for the title.
     */
    webLink(href: string, describe: string): HTMLElement;
}

export interface SourceView {
    descriptor: SourceDescriptor;
    /** Rows appended to the Details section after the shared ones. */
    detailRows(listing: Listing, ctx: ViewContext): DetailRow[];
    sections?(listing: Listing): ViewSection[];
}
