/** What Zillow says beyond the shared `core`, kept in `listing.detail.data`. Bump the version when the shape changes. */
export const ZILLOW_DETAIL_VERSION = 1;

export interface ZillowDetail {
    /** Zillow's word for what it is: "APARTMENT", "TOWNHOUSE", "SINGLE_FAMILY", … (homes), or the building's `homeTypes`. */
    homeType: string | null;
    /** A building's numeric lot id. The URL key is `sourceId`. */
    lotId: string | null;
    /** The building a home is in (every home has one): `buildingKey` is a building listing's `sourceId`, `buildingLotId` its `lotId`. */
    buildingKey: string | null;
    buildingLotId: string | null;
    buildingName: string | null;
    /** The building's page, for a home whose building is not saved. */
    buildingUrl: string | null;
    /** A home's `homeStatus` as Zillow states it: "FOR_RENT", "FOR_SALE", "OTHER" (off market), … */
    status: string | null;
    /** Zillow's rent estimate for a home, when shown. */
    rentZestimate: number | null;
    walkScore: number | null;
    transitScore: number | null;
    bikeScore: number | null;
    yearBuilt: number | null;
}
