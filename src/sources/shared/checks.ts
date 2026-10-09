import type { Check, CheckResult, SourceUrls } from "../contract";
import { canonicalHref, hasHeading, ogUrl } from "./dom";

/**
 * Checks most sites can use as they are. Weights follow the convention
 * CONFIRM_SCORE in content/detect.ts assumes: a structured claim by the
 * server is worth 2, layout markers 1, and no single check reaches the bar.
 */

/** The canonical link names a listing and the page has a heading. */
export function canonicalCheck(urls: SourceUrls, weight = 2): Check {
    return (doc) => {
        const href = canonicalHref(doc);
        const ref = href ? urls.parse(href) : null;
        const heading = hasHeading(doc);
        const matched = ref !== null && heading;
        return {
            name: "canonical",
            matched,
            weight,
            matchedId: matched ? ref.sourceId : null,
            detail: `canonical=${ref ? "listing" : href ? "other" : "none"} h1=${heading ? "yes" : "no"}`,
        };
    };
}

/** og:url names a listing. Weak alone: some sites emit it on search pages too. */
export function ogUrlCheck(urls: SourceUrls, weight = 1): Check {
    return (doc) => {
        const href = ogUrl(doc);
        const ref = href ? urls.parse(href) : null;
        return {
            name: "og:url",
            matched: ref !== null,
            weight,
            matchedId: ref?.sourceId ?? null,
            detail: ref ? "listing" : href ? "other" : "none",
        };
    };
}

/** Layout markers: matched when at least `minimum` of the selectors are on the page. Claims no id. */
export function markerCheck(selectors: readonly string[], minimum = 2, weight = 1): Check {
    return (doc) => {
        const hits = selectors.filter((selector) => doc.querySelector(selector) !== null);
        return {
            name: "markers",
            matched: hits.length >= minimum,
            weight,
            matchedId: null,
            detail: `${hits.length}/${selectors.length} markers`,
        };
    };
}

/** A check that found nothing. */
export function unmatched(name: string, weight: number, detail: string): CheckResult {
    return { name, matched: false, weight, matchedId: null, detail };
}
