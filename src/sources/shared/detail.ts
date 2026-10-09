import type { Listing } from "../../db/types";

/** A listing's `detail.data` as the source's own type, when the listing is that source's at the given version; null otherwise. */
export function sourceDetail<T>(listing: Listing, sourceId: string, version: number): T | null {
    if (listing.source !== sourceId || listing.detail.version !== version) return null;
    return listing.detail.data as T;
}
