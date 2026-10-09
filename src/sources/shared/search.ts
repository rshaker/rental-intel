/**
 * Helpers for a source's search-results reader. Content-script side, so
 * nothing from the panel may be imported here; the panel's format.ts has
 * the same words for the same facts, written for a saved listing.
 */

/** "2bd/1ba · 850 sqft" from a result card's numbers; null when it has none. */
export function factsText(beds: number | null, baths: number | null, sqft: number | null): string | null {
    const rooms: string[] = [];
    if (beds !== null) rooms.push(beds === 0 ? "Studio" : `${beds}bd`);
    if (baths !== null) rooms.push(`${baths}ba`);
    const parts: string[] = [];
    if (rooms.length) parts.push(rooms.join("/"));
    if (sqft !== null) parts.push(`${sqft.toLocaleString("en-US")} sqft`);
    return parts.length ? parts.join(" · ") : null;
}
