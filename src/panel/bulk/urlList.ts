import { sameRef, type ListingKind, type ListingRef } from "../../db/types";
import type { SourceDescriptor } from "../../sources/contract";
import { sourceForUrl } from "../../sources";
import type { SourceId } from "../../sources/descriptors";

/**
 * Reading a user-supplied list of listing URLs: one per line, plain text.
 *
 * Pure string logic, so the unit tests can pin it without a browser. The
 * tolerance here is deliberate and small: blank lines and `#` comments are
 * ignored, a missing scheme is forgiven, and only the first whitespace-separated
 * token of a line is read, so a line pasted from a document as
 * `<url> -- my note` still loads. Anything that is not a listing URL of a
 * known site is reported back rather than guessed at; a listing on a site
 * that is known but not enabled is reported separately, since the fix is a
 * switch on the Sources tab.
 */

export interface UrlEntry {
    /** The URL as it will be loaded, normalised by the URL parser. */
    url: string;
    ref: ListingRef;
    /** What the URL shape says, when it says anything. */
    kind: ListingKind | null;
}

export interface ParsedUrlList {
    /** One per listing, in file order; a repeated listing keeps its first URL. */
    entries: UrlEntry[];
    /** Lines that were neither blank, a comment, nor a recognisable listing URL. */
    skipped: string[];
    /** Listing URLs of sites that are known but not enabled, with the site's label. */
    disabled: { line: string; source: string }[];
    /** Lines dropped because an earlier line already named the same listing. */
    duplicates: number;
}

export function parseUrlList(text: string, isEnabled: (source: SourceDescriptor) => boolean): ParsedUrlList {
    const entries: UrlEntry[] = [];
    const skipped: string[] = [];
    const disabled: { line: string; source: string }[] = [];
    let duplicates = 0;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) continue;

        const url = asUrl(line);
        const source = url ? sourceForUrl(url) : null;
        const parsed = url && source ? source.urls.parse(url) : null;
        if (!url || !source || !parsed) {
            skipped.push(line);
            continue;
        }
        if (!isEnabled(source)) {
            disabled.push({ line, source: source.label });
            continue;
        }
        const ref: ListingRef = { source: source.id as SourceId, sourceId: parsed.sourceId };
        if (entries.some((entry) => sameRef(entry.ref, ref))) {
            duplicates += 1;
            continue;
        }
        entries.push({ url: source.urls.canonical(url), ref, kind: parsed.kind });
    }

    return { entries, skipped, disabled, duplicates };
}

/** The line's first token as an http(s) URL, or null. */
function asUrl(line: string): string | null {
    const token = line.split(/\s+/)[0] ?? "";
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ? token : `https://${token}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
}
