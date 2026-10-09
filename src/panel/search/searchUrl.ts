import { matchesAny } from "../../lib/matchPattern";
import type { SourceDescriptor } from "../../sources/contract";

/** The page a search form's text opens: a URL on the site as it is, else the source's search URL for the text. Null when neither works. */
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
