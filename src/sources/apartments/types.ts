/**
 * What apartments.com says about a listing beyond the shared `core`, kept
 * in `listing.detail.data`. Bump `APARTMENTS_DETAIL_VERSION` when this
 * changes shape.
 */
export const APARTMENTS_DETAIL_VERSION = 1;

export interface ApartmentsModel {
    /** The site's model (floor plan) id, from `data-model`. */
    id: string | null;
    name: string | null;
    /** Rental keys of the units under this model, from `data-rentalkey`, in page order. */
    rentalKeys: string[];
}

export interface ApartmentsDetail {
    /** The site's listing id, from `data-listingid`, when the page carries it; the URL key is `sourceId`. */
    listingId: string | null;
    /** Which readers produced the capture, for diagnosing a redesign: "jsonld", "dom". */
    via: string[];
    models: ApartmentsModel[];
    rating: number | null;
    reviewCount: number | null;
    walkScore: number | null;
    transitScore: number | null;
    bikeScore: number | null;
    yearBuilt: number | null;
    unitCount: number | null;
    /** The site's own property-type label ("Apartment", "Condo", …). */
    propertyTypeLabel: string | null;
}
