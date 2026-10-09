import type { ListingCapture, ListingKind } from "../../db/types";
import type { Probe, SearchResult, Signal, SourcePage } from "../contract";
import { canonicalHref, hasHeading, ogUrl } from "../shared/dom";
import { ldNodes, ldTypes } from "../shared/jsonld";
import { absent, markerProbe } from "../shared/probes";
import { clean } from "../shared/values";
import { zillow } from "./descriptor";
import { buildingFromDom, homeFromDom } from "./page/dom";
import { buildingFrom, homeFrom } from "./page/fields";
import { buildingKeyOf, findBuildingNodeIn, findPropertyNodeIn, readHydrationStates } from "./page/hydration";
import { readSearchResults } from "./page/searchResults";
import { idString } from "../shared/values";
import { ZILLOW_DETAIL_VERSION } from "./types";
import { kindOfZillowId, zillowPageUrl, zillowSearch, zillowUrls } from "./urls";

/**
 * Recognising and reading a Zillow page. Two kinds of page, each with its
 * own payload node and furniture: a home (`/homedetails/…/<zpid>_zpid/`) and
 * a building (`/apartments/…/<key>/`). The URL's id says which kind is
 * wanted -- a zpid is digits, a key is not -- and each probe looks for that
 * kind only, so a unit page whose payload also describes its building is not
 * in conflict with itself: the building is an attribute of the unit, read by
 * extraction, not a competing identity.
 *
 * A forced parse (no listing in the URL) tries a home first: a building page
 * with a unit open carries both, and the unit is the more specific answer.
 */

/** Home-page furniture. `price` alone is not enough -- search cards carry it too. */
const HOME_MARKERS = [
    '[data-testid="price"]',
    '[data-testid="bed-bath-sqft-fact-container"]',
    '[data-testid="bed-bath-sqft-facts"]',
    '[data-testid="hollywood-gallery"]',
    '[data-testid="home-details-chip-container"]',
];

/** Building-page furniture, none of which a home page has. */
const BUILDING_MARKERS = ['[data-testid="bdp-wrapper"]', '[data-testid="hero-photos-wrapper"]', '[data-testid="unit-table-body"]', '[data-testid="building-built-info"]'];

const HOME_LD_TYPES = new Set(["Residence", "SingleFamilyResidence", "Apartment", "Product"]);
const BUILDING_LD_TYPES = new Set(["ApartmentComplex"]);

/** The kind a probe should look for: the URL's, or both when the URL names nothing. */
function wantedKinds(urlSubject: string | null): ListingKind[] {
    return urlSubject ? [kindOfZillowId(urlSubject)] : ["home", "building"];
}

/**
 * (a) The hydration payload: a node of the wanted kind. The strongest signal
 * on the page. It claims the listing the payload *actually* describes: the
 * URL's when any blob has it, otherwise whatever the first blob holds -- a
 * page that has moved on in-page still carries the previous listing's
 * payload, and that must count against confirmation, not for it, until the
 * page-world helper publishes the new one.
 */
function hydrationProbe(doc: Document, urlSubject: string | null): Signal {
    const states = readHydrationStates(doc);
    if (states.length === 0) return absent("hydration", 2, "no payload");
    for (const kind of wantedKinds(urlSubject)) {
        if (kind === "home") {
            const found = findPropertyNodeIn(states, urlSubject);
            if (found) {
                const claim = idString(found.node["zpid"]);
                return { name: "hydration", present: true, weight: 2, claim, detail: found.wanted ? "home payload for this listing" : `home payload for ${claim ?? "another listing"}` };
            }
        } else {
            const found = findBuildingNodeIn(states, urlSubject);
            if (found) {
                const claim = buildingKeyOf(found.node);
                return { name: "hydration", present: true, weight: 2, claim, detail: found.wanted ? "building payload for this listing" : `building payload for ${claim ?? "another building"}` };
            }
        }
    }
    return absent("hydration", 2, "payload of another kind");
}

/**
 * An address-like <h1>. The chip container is the real thing when present; the
 * fallback wants a street number, since a digit is what separates "1234 Elm St"
 * from a marketing headline.
 */
function addressHeading(doc: Document): boolean {
    if (doc.querySelector('[data-testid="home-details-chip-container"] h1')) return true;
    for (const h1 of doc.querySelectorAll("h1")) {
        const text = clean(h1.textContent) ?? "";
        if (text.length >= 8 && /\d/.test(text)) return true;
    }
    return false;
}

/** (d) Canonical link naming a listing of the wanted kind, plus a rendered heading: a home's is an address, a building's a name. */
function canonicalProbe(doc: Document, urlSubject: string | null): Signal {
    const href = canonicalHref(doc);
    const ref = href ? zillowUrls.parse(href) : null;
    const kinds = wantedKinds(urlSubject);
    if (!ref || !kinds.includes(ref.kind ?? "home")) return absent("canonical", 2, ref ? "canonical of another kind" : href ? "canonical is not a listing" : "no canonical");
    const heading = ref.kind === "home" ? addressHeading(doc) : hasHeading(doc);
    return { name: "canonical", present: heading, weight: 2, claim: heading ? ref.sourceId : null, detail: `canonical=${ref.kind} h1=${heading ? "yes" : "no"}` };
}

/**
 * (c) Structured metadata: og:url, or a JSON-LD node of the kind's types.
 * Survives redesigns better than CSS selectors do, because it exists for
 * crawlers rather than for the layout. A URL of the *other* kind does not
 * count as present -- a building's og:url says nothing about a home.
 */
function metadataProbe(doc: Document, urlSubject: string | null): Signal {
    const kinds = wantedKinds(urlSubject);
    const og = ogUrl(doc);
    const ogRef = og ? zillowUrls.parse(og) : null;
    const claim = ogRef && kinds.includes(ogRef.kind ?? "home") ? ogRef.sourceId : null;
    const types = new Set(kinds.flatMap((kind) => [...(kind === "home" ? HOME_LD_TYPES : BUILDING_LD_TYPES)]));
    const ld = ldNodes(doc).some((node) => ldTypes(node).some((type) => types.has(type)));
    return { name: "metadata", present: claim !== null || ld, weight: 1, claim, detail: `og:url=${claim ? "yes" : og ? "other" : "no"} ld+json=${ld ? "yes" : "no"}` };
}

/** (b) Zillow's own test hooks for the wanted kind. Cheap, and the first thing a redesign breaks. */
function markersProbe(doc: Document, urlSubject: string | null): Signal {
    for (const kind of wantedKinds(urlSubject)) {
        const signal = markerProbe(kind === "home" ? HOME_MARKERS : BUILDING_MARKERS)(doc, urlSubject);
        if (signal.present) return { ...signal, detail: `${kind}: ${signal.detail}` };
    }
    return absent("markers", 1, "no kind's markers");
}

const probes: Probe[] = [hydrationProbe, canonicalProbe, metadataProbe, markersProbe];

function extract(doc: Document, url: string, sourceId: string): ListingCapture | null {
    const kind = kindOfZillowId(sourceId);
    const states = readHydrationStates(doc);
    // Only the wanted node will do: a payload describing another listing is
    // worse than the layout, which at least shows the page the user sees.
    const found = kind === "home" ? findPropertyNodeIn(states, sourceId) : findBuildingNodeIn(states, sourceId);
    const node = found?.wanted ? found.node : null;
    const read = node ? (kind === "home" ? homeFrom(node) : buildingFrom(node)) : kind === "home" ? homeFromDom(doc) : buildingFromDom(doc);
    if (!node && !read.core.address.text && !read.core.name) return null;

    return {
        sourceId,
        url: zillowUrls.canonical(url),
        kind,
        core: read.core,
        detail: { version: ZILLOW_DETAIL_VERSION, data: read.detail },
        via: read.detail.via,
        partial: node === null,
        // The node alone, not the whole payload: the payload holds the nearby
        // listings' data too and runs to half a megabyte.
        raw: node ?? { via: "dom-fallback" },
    };
}

/** The result list of a search page (page/searchResults.ts); nothing for any other page. */
function searchResults(doc: Document, url: string): SearchResult[] | null {
    return zillowSearch.isSearchUrl(url) ? readSearchResults(doc) : null;
}

/**
 * The next page of a search. The site lists 41 results a page and links the
 * rest from `.search-pagination`, whose `a[rel=next]` carries the next
 * page's URL (/austin-tx-78701/rentals/2_p/). On the last page the link is
 * still there, pointing at the page itself and marked aria-disabled.
 * The link carries no `searchQueryState`, so on a filtered search only its
 * page number is taken (urls.ts, zillowPageUrl).
 * Checked against the live site, 2026-10-03.
 */
function searchNextUrl(doc: Document, url: string): string | null {
    if (!zillowSearch.isSearchUrl(url)) return null;
    const link = doc.querySelector('.search-pagination a[rel="next"][href], nav[aria-label="Pagination"] a[rel="next"][href]');
    const href = link?.getAttribute("href");
    if (!link || !href || link.getAttribute("aria-disabled") === "true") return null;
    try {
        const next = new URL(href, url);
        next.hash = "";
        if (next.href === url || !zillowSearch.isSearchUrl(next.href)) return null;
        // The link names the page but drops the filters; a filtered search keeps its own URL.
        const page = Number(/\/(\d+)_p\/?$/.exec(next.pathname)?.[1]);
        return (page ? zillowPageUrl(url, page) : null) ?? next.href;
    } catch {
        return null;
    }
}

/** The site's check that the visitor is a person, which it serves in place of a page it has decided not to show. */
function challenge(doc: Document): string | null {
    if (/access to this page has been denied/i.test(doc.title) || doc.querySelector("#px-captcha")) return "Zillow is asking you to prove you are a person. Answer it in the tab.";
    return null;
}

export const zillowPage: SourcePage = { descriptor: zillow, probes, extract, searchResults, searchNextUrl, challenge: (doc) => challenge(doc) };
