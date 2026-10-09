import type { ListingCapture, ListingKind } from "../../db/types";
import type { Check, CheckResult, SearchResult, SourcePage } from "../contract";
import { canonicalHref, hasHeading, ogUrl } from "../shared/dom";
import { ldNodes, ldTypes } from "../shared/jsonld";
import { markerCheck, unmatched } from "../shared/checks";
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
 * own payload node and layout markers: a home (`/homedetails/…/<zpid>_zpid/`)
 * and a building (`/apartments/…/<key>/`). The URL's id says which kind is
 * wanted, and each check looks for that kind only, so a unit page whose
 * payload also describes its building is not in conflict with itself. A
 * manual capture with no listing in the URL tries a home first.
 */

/** Home-page markers. `price` alone is not enough: search cards carry it too. */
const HOME_MARKERS = [
    '[data-testid="price"]',
    '[data-testid="bed-bath-sqft-fact-container"]',
    '[data-testid="bed-bath-sqft-facts"]',
    '[data-testid="hollywood-gallery"]',
    '[data-testid="home-details-chip-container"]',
];

/** Building-page markers, none of which a home page has. */
const BUILDING_MARKERS = ['[data-testid="bdp-wrapper"]', '[data-testid="hero-photos-wrapper"]', '[data-testid="unit-table-body"]', '[data-testid="building-built-info"]'];

const HOME_LD_TYPES = new Set(["Residence", "SingleFamilyResidence", "Apartment", "Product"]);
const BUILDING_LD_TYPES = new Set(["ApartmentComplex"]);

/** The kind a check should look for: the URL's, or both when the URL names nothing. */
function wantedKinds(urlListingId: string | null): ListingKind[] {
    return urlListingId ? [kindOfZillowId(urlListingId)] : ["home", "building"];
}

/** The hydration payload: a node of the wanted kind. Names the listing the payload describes, which after an in-page move may still be the previous one until the main-world script publishes the new state. */
function hydrationCheck(doc: Document, urlListingId: string | null): CheckResult {
    const states = readHydrationStates(doc);
    if (states.length === 0) return unmatched("hydration", 2, "no payload");
    for (const kind of wantedKinds(urlListingId)) {
        if (kind === "home") {
            const found = findPropertyNodeIn(states, urlListingId);
            if (found) {
                const claim = idString(found.node["zpid"]);
                return { name: "hydration", matched: true, weight: 2, matchedId: claim, detail: found.wanted ? "home payload for this listing" : `home payload for ${claim ?? "another listing"}` };
            }
        } else {
            const found = findBuildingNodeIn(states, urlListingId);
            if (found) {
                const claim = buildingKeyOf(found.node);
                return { name: "hydration", matched: true, weight: 2, matchedId: claim, detail: found.wanted ? "building payload for this listing" : `building payload for ${claim ?? "another building"}` };
            }
        }
    }
    return unmatched("hydration", 2, "payload of another kind");
}

/** An address-like <h1>: the chip container's, or any heading with a street number. */
function addressHeading(doc: Document): boolean {
    if (doc.querySelector('[data-testid="home-details-chip-container"] h1')) return true;
    for (const h1 of doc.querySelectorAll("h1")) {
        const text = clean(h1.textContent) ?? "";
        if (text.length >= 8 && /\d/.test(text)) return true;
    }
    return false;
}

/** The canonical link names a listing of the wanted kind and the page has a heading: an address for a home, a name for a building. */
function canonicalCheck(doc: Document, urlListingId: string | null): CheckResult {
    const href = canonicalHref(doc);
    const ref = href ? zillowUrls.parse(href) : null;
    const kinds = wantedKinds(urlListingId);
    if (!ref || !kinds.includes(ref.kind ?? "home")) return unmatched("canonical", 2, ref ? "canonical of another kind" : href ? "canonical is not a listing" : "no canonical");
    const heading = ref.kind === "home" ? addressHeading(doc) : hasHeading(doc);
    return { name: "canonical", matched: heading, weight: 2, matchedId: heading ? ref.sourceId : null, detail: `canonical=${ref.kind} h1=${heading ? "yes" : "no"}` };
}

/** Structured metadata: og:url, or a JSON-LD node of the kind's types. A URL of the other kind does not count. */
function metadataCheck(doc: Document, urlListingId: string | null): CheckResult {
    const kinds = wantedKinds(urlListingId);
    const og = ogUrl(doc);
    const ogRef = og ? zillowUrls.parse(og) : null;
    const claim = ogRef && kinds.includes(ogRef.kind ?? "home") ? ogRef.sourceId : null;
    const types = new Set(kinds.flatMap((kind) => [...(kind === "home" ? HOME_LD_TYPES : BUILDING_LD_TYPES)]));
    const ld = ldNodes(doc).some((node) => ldTypes(node).some((type) => types.has(type)));
    return { name: "metadata", matched: claim !== null || ld, weight: 1, matchedId: claim, detail: `og:url=${claim ? "yes" : og ? "other" : "no"} ld+json=${ld ? "yes" : "no"}` };
}

/** Zillow's own test hooks for the wanted kind. */
function markersCheck(doc: Document, urlListingId: string | null): CheckResult {
    for (const kind of wantedKinds(urlListingId)) {
        const result = markerCheck(kind === "home" ? HOME_MARKERS : BUILDING_MARKERS)(doc, urlListingId);
        if (result.matched) return { ...result, detail: `${kind}: ${result.detail}` };
    }
    return unmatched("markers", 1, "no kind's markers");
}

const checks: Check[] = [hydrationCheck, canonicalCheck, metadataCheck, markersCheck];

function extract(doc: Document, url: string, sourceId: string): ListingCapture | null {
    const kind = kindOfZillowId(sourceId);
    const states = readHydrationStates(doc);
    // Only the wanted node will do: a payload describing another listing is worse than the layout.
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
        readMethod: node ? "hydration" : "dom",
        partial: node === null,
    };
}

/** The result list of a search page (page/searchResults.ts); nothing for any other page. */
function searchResults(doc: Document, url: string): SearchResult[] | null {
    return zillowSearch.isSearchUrl(url) ? readSearchResults(doc) : null;
}

/** The next page of a search, from `.search-pagination a[rel=next]`; on the last page it points at itself and is aria-disabled. The link drops the filters, so only its page number is taken (checked live, 2026-10-03). */
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

export const zillowPage: SourcePage = { descriptor: zillow, checks, extract, searchResults, searchNextUrl, challenge: (doc) => challenge(doc) };
