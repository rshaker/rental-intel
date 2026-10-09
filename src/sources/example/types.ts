/**
 * What the example site says about a listing beyond the shared `core`: the
 * part of a site's model that has no cross-site meaning and so lives in
 * `listing.detail.data`. Bump `EXAMPLE_DETAIL_VERSION` when this changes.
 */
export const EXAMPLE_DETAIL_VERSION = 1;

export interface ExampleDetail {
    /** The site's own listing id, as `sourceId` but kept here too so the detail is self-describing. */
    listingId: string;
    /** The site's rating, 0-5, when shown. */
    rating: number | null;
    /** The site's unit ids, in page order, for the Details section. */
    unitIds: string[];
}
