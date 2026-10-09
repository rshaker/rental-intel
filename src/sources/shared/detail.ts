import type { Listing } from "../../db/types";

/**
 * A listing's `detail.data` as the source's own type, when the listing is
 * that source's and was written by a reader of the given version. Null
 * otherwise: a view must show nothing rather than guess at an older shape.
 */
export function sourceDetail<T>(listing: Listing, sourceId: string, version: number): T | null {
    if (listing.source !== sourceId || listing.detail.version !== version) return null;
    return listing.detail.data as T;
}
