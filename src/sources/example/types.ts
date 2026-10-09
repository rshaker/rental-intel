/** What the example site says beyond the shared `core`, kept in `listing.detail.data`. Bump the version when the shape changes. */
export const EXAMPLE_DETAIL_VERSION = 1;

export interface ExampleDetail {
    listingId: string;
    /** The site's rating, 0-5, when shown. */
    rating: number | null;
    /** The site's unit ids, in page order, for the Details section. */
    unitIds: string[];
}
