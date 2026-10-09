/**
 * What Zillow says about a listing beyond the shared `core`, kept in
 * `listing.detail.data`. Bump `ZILLOW_DETAIL_VERSION` when this changes.
 */
export const ZILLOW_DETAIL_VERSION = 1;

export interface ZillowDetail {
    /** Zillow's word for what it is: "APARTMENT", "TOWNHOUSE", "SINGLE_FAMILY", … (homes), or the building's `homeTypes`. */
    homeType: string | null;
    /** A building's numeric lot id. The URL key is `sourceId`. */
    lotId: string | null;
    /**
     * The building a home is in. Zillow gives every home one, even a
     * detached house (a one-unit "building"). `buildingKey` is a building
     * listing's `sourceId`; `buildingLotId` its `lotId`.
     */
    buildingKey: string | null;
    buildingLotId: string | null;
    buildingName: string | null;
    /** The building's page, for a home whose building is not saved. */
    buildingUrl: string | null;
    /**
     * A home's `homeStatus` as Zillow states it: "FOR_RENT", "FOR_SALE",
     * "RECENTLY_SOLD", "OTHER" (off market), … A building has none.
     */
    status: string | null;
    /** Zillow's rent estimate for a home, when shown. */
    rentZestimate: number | null;
    walkScore: number | null;
    transitScore: number | null;
    bikeScore: number | null;
    yearBuilt: number | null;
    /** How the fields were read: "hydration" or "dom". */
    via: string;
}
