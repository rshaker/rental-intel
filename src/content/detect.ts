import type { CheckResult, SourcePage, UrlRef } from "../sources/contract";

/**
 * Deciding whether this document is one listing, and which. The URL alone is
 * not enough: pages that merely look like listing URLs exist, and during an
 * in-page navigation the URL moves a beat before the document does. So the
 * URL is necessary, the page content is necessary, and a check that names a
 * listing must name this one.
 */

export interface Detection {
    urlRef: UrlRef | null;
    /** `urlRef.sourceId`, else the first matched check's id: what a manual capture reads. */
    listingId: string | null;
    score: number;
    confirmed: boolean;
    results: CheckResult[];
}

/** Out of the weights a source's checks add up to (6 for the usual set). Three means no single check confirms alone. */
export const CONFIRM_SCORE = 3;

export function detectListing(page: SourcePage, doc: Document, url: string): Detection {
    const urlRef = page.descriptor.urls.parse(url);
    const urlListingId = urlRef?.sourceId ?? null;
    const results = page.checks.map((check) => check(doc, urlListingId));
    const score = results.reduce((total, result) => total + (result.matched ? result.weight : 0), 0);
    const ids = results.filter((result) => result.matched && result.matchedId !== null).map((result) => result.matchedId!);
    const listingId = urlListingId ?? ids[0] ?? null;
    // A page where only anonymous checks matched (a search page) is not confirmed; nor is one where a check still names the previous listing.
    const conflict = listingId !== null && ids.some((id) => id !== listingId);
    const named = listingId !== null && ids.some((id) => id === listingId);
    return { urlRef, listingId, score, results, confirmed: urlListingId !== null && !conflict && named && score >= CONFIRM_SCORE };
}

/** The checks of a detection as one line, for the log and for test failures. */
export function describeChecks(detection: Detection): string {
    return detection.results.map((r) => `${r.name}:${r.matched ? r.weight : 0} ${r.detail}`).join(" | ");
}

/** A capture on the user's say-so: needs only a listing id, from the URL or from a check, not a confirmation. */
export function manualCapture(page: SourcePage, doc: Document, url: string): ReturnType<SourcePage["extract"]> {
    const { listingId } = detectListing(page, doc, url);
    return listingId ? page.extract(doc, url, listingId) : null;
}
