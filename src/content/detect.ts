import type { ListingCapture } from "../db/types";
import type { Signal, SourcePage, UrlRef } from "../sources/contract";

/**
 * Deciding whether this document really is one listing, and which.
 *
 * A URL match alone is not enough. It is wrong in two directions: pages that
 * merely look like listing URLs (a neighbourhood page on apartments.com, a
 * search page on Zillow) would be announced with nothing behind them, and --
 * worse -- during an SPA navigation `location.href` flips to listing B a beat
 * before the DOM swaps, so a URL-only check would happily pair B's id with A's
 * price and photos.
 *
 * So: the URL is necessary, the page content is necessary, and neither is
 * sufficient. The source's probes vote independently, and a probe that claims
 * an identity must claim *this* one.
 */

export interface Detection {
    urlRef: UrlRef | null;
    /** Best DOM-derived identity: the first present probe's claim, strongest probe first. */
    domSubject: string | null;
    /** `urlRef.sourceId ?? domSubject` -- the fallback order a forced parse relies on. */
    subject: string | null;
    score: number;
    /** Some present signal claims an identity that disagrees with `subject`. */
    conflict: boolean;
    /** Some present signal claims an identity that agrees with `subject`. */
    claimed: boolean;
    confirmed: boolean;
    signals: Signal[];
}

/**
 * Threshold, out of the weights a source's probes add up to (6 for the usual
 * set: two structured signals at 2, two furniture signals at 1).
 *
 * Three means no single signal can confirm on its own: a structured claim is
 * worth more than the weak signals but still short of the bar. One redesigned
 * selector therefore degrades detection instead of breaking it, and "the DOM
 * alone said so" can never be the whole story.
 */
export const CONFIRM_SCORE = 3;

/** Everything the page and the URL together say about which listing this is. */
export function detectListing(page: SourcePage, doc: Document, url: string): Detection {
    const urlRef = page.descriptor.urls.parse(url);
    const urlSubject = urlRef?.sourceId ?? null;

    // Order matters: `domSubject` takes the first claim, strongest probe first.
    const signals = page.probes.map((probe) => probe(doc, urlSubject));

    const score = signals.reduce((total, signal) => total + (signal.present ? signal.weight : 0), 0);
    const claims = signals.filter((signal) => signal.present && signal.claim !== null).map((signal) => signal.claim!);
    const domSubject = claims[0] ?? null;
    const subject = urlSubject ?? domSubject;

    const conflict = subject !== null && claims.some((claim) => claim !== subject);
    const claimed = subject !== null && claims.some((claim) => claim === subject);

    return {
        urlRef,
        domSubject,
        subject,
        score,
        conflict,
        claimed,
        signals,
        // `claimed` rules out pages where only anonymous signals fired, which is
        // what a search results page looks like. `conflict` rules out the
        // mid-navigation window where the DOM still describes the previous
        // listing -- the case that would otherwise write a corrupt record.
        confirmed: urlSubject !== null && !conflict && claimed && score >= CONFIRM_SCORE,
    };
}

/** The signals of a detection as one line, for the log and for test failures. */
export function describeSignals(detection: Detection): string {
    return detection.signals.map((s) => `${s.name}:${s.present ? s.weight : 0} ${s.detail}`).join(" | ");
}

/**
 * Turns a recognised page into a capture.
 *
 * Note the deliberate asymmetry with detection: this does *not* require
 * `detection.confirmed`. Confirmation gates what the panel announces, where a
 * false positive would be silently wrong. Reaching here means the user clicked,
 * which is them explicitly saying "try this page anyway" -- so all we need is a
 * subject, and `subject` will fall back to the DOM when the URL names none.
 */
export function extractCapture(page: SourcePage, doc: Document, url: string): ListingCapture | null {
    const { subject } = detectListing(page, doc, url);
    if (!subject) return null;
    return page.extract(doc, url, subject);
}
