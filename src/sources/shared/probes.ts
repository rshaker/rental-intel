import type { Probe, Signal, SourceUrls } from "../contract";
import { canonicalHref, hasHeading, ogUrl } from "./dom";

/**
 * Probes most sites can use as they are. Each returns one independent
 * `Signal` for detect.ts to score. The weights follow the convention the
 * scoring threshold assumes (see CONFIRM_SCORE in src/content/detect.ts):
 * a structured claim by the server is worth 2, page furniture is worth 1,
 * and no single signal reaches the bar alone.
 */

/**
 * The canonical link names a listing and the page has a heading: the
 * document stating "I am one listing" about as plainly as HTML allows.
 */
export function canonicalProbe(urls: SourceUrls, weight = 2): Probe {
    return (doc) => {
        const href = canonicalHref(doc);
        const ref = href ? urls.parse(href) : null;
        const heading = hasHeading(doc);
        const present = ref !== null && heading;
        return {
            name: "canonical",
            present,
            weight,
            claim: present ? ref.sourceId : null,
            detail: `canonical=${ref ? "listing" : href ? "other" : "none"} h1=${heading ? "yes" : "no"}`,
        };
    };
}

/** og:url names a listing. Weak on its own -- some sites emit it on search pages too. */
export function ogUrlProbe(urls: SourceUrls, weight = 1): Probe {
    return (doc) => {
        const href = ogUrl(doc);
        const ref = href ? urls.parse(href) : null;
        return {
            name: "og:url",
            present: ref !== null,
            weight,
            claim: ref?.sourceId ?? null,
            detail: ref ? "listing" : href ? "other" : "none",
        };
    };
}

/**
 * Page furniture: present when at least `minimum` of the selectors match.
 * Cheap, anonymous (it claims nothing), and the first thing a redesign
 * breaks, which is why it is worth 1.
 */
export function markerProbe(selectors: readonly string[], minimum = 2, weight = 1): Probe {
    return (doc) => {
        const hits = selectors.filter((selector) => doc.querySelector(selector) !== null);
        return {
            name: "markers",
            present: hits.length >= minimum,
            weight,
            claim: null,
            detail: `${hits.length}/${selectors.length} markers`,
        };
    };
}

/** A signal that is simply absent, for a probe that found nothing to say. */
export function absent(name: string, weight: number, detail: string): Signal {
    return { name, present: false, weight, claim: null, detail };
}
