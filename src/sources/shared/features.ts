import { FEATURE_KEYS, type FeatureKey } from "./filters.js";

/**
 * Reading a page's features into the shared vocabulary (filters.ts). The
 * vocabulary knows no site: each source keeps its own table of what its
 * pages say for each feature, next to its extractor, and `extract` writes
 * the result to `core.features`. These helpers are the common shapes of
 * that table: a pattern per feature over the site's labels, and the pet
 * words every site uses.
 */

/** A pattern per feature, matched against a site's own labels ("Washer/Dryer", "Fitness Center"). */
export type FeatureWords = Partial<Record<FeatureKey, RegExp>>;

/** `keys` without repeats, in vocabulary order: how `core.features` is stored. */
export function orderedFeatures(keys: Iterable<FeatureKey>): FeatureKey[] {
    const wanted = new Set(keys);
    return FEATURE_KEYS.filter((key) => wanted.has(key));
}

/** The features any of `labels` names, by `words`. */
export function featuresInWords(labels: Iterable<string>, words: FeatureWords): FeatureKey[] {
    const found = new Set<FeatureKey>();
    for (const label of labels) for (const [key, pattern] of Object.entries(words) as [FeatureKey, RegExp][]) if (pattern.test(label)) found.add(key);
    return orderedFeatures(found);
}

/**
 * The pets `labels` allow, as the sites word them: "Cats", "Small dogs",
 * "Large dogs", and "Dogs" alone for both sizes. A label is one policy
 * heading, not a whole paragraph: one saying no ("No pets", "Dogs not
 * allowed") names nothing.
 */
export function petFeatures(labels: Iterable<string>): FeatureKey[] {
    const found = new Set<FeatureKey>();
    for (const label of labels) {
        if (/\bno\b|\bnot\b/i.test(label)) continue;
        if (/\bcats?\b/i.test(label)) found.add("cats");
        const small = /small\s*dogs?\b/i.test(label);
        const large = /large\s*dogs?\b/i.test(label);
        const any = /\bdogs?\b/i.test(label);
        if (small || (any && !large)) found.add("smallDogs");
        if (large || (any && !small)) found.add("largeDogs");
    }
    return orderedFeatures(found);
}
