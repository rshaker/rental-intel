import { matchesAny } from "../../lib/matchPattern";
import type { SourceDescriptor } from "../../sources/contract";

/**
 * What a site's search form does with its one text field. A URL on the site
 * is used as it is -- a search page the user set up on the site itself, with
 * every filter the form does not offer -- and anything else is handed to
 * the source to turn into its search URL. Null when neither works: a URL on
 * some other site, blank text, or a source that cannot be searched.
 */
export function resolveSearchUrl(source: SourceDescriptor, text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            new URL(trimmed);
        } catch {
            return null;
        }
        return matchesAny(source.hosts.pages, trimmed) ? trimmed : null;
    }
    return source.search?.searchUrl(trimmed) ?? null;
}
