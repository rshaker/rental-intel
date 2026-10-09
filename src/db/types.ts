import type { SourceId } from "../sources/descriptors.js";
import type { FeatureKey } from "../sources/shared/filters.js";

/**
 * Record shapes for the listing database. A listing is what one site says
 * about one thing it lists: the site's own id, a `core` shaped the same for
 * every site and kind, a `detail` only that site's plugin reads, and a `user`
 * part a re-capture never touches.
 */

/** A `home` has a page of its own; a `building` lists plans and units that have none. */
export type ListingKind = "home" | "building";

export const LISTING_KINDS: readonly ListingKind[] = ["home", "building"];

export type ListingStatus = "none" | "interested" | "not-interested" | "scheduled" | "visited" | "applied" | "rejected";

export const LISTING_STATUSES: readonly ListingStatus[] = ["none", "interested", "not-interested", "scheduled", "visited", "applied", "rejected"];

export const STATUS_LABELS: Record<ListingStatus, string> = {
    none: "None",
    interested: "Interested",
    "not-interested": "Not interested",
    scheduled: "Scheduled",
    visited: "Visited",
    applied: "Applied",
    rejected: "Rejected",
};

/** One listing as the site names it; the key of the `[source+sourceId]` index. */
export interface ListingRef {
    source: SourceId;
    sourceId: string;
}

export function sameRef(a: ListingRef | null | undefined, b: ListingRef | null | undefined): boolean {
    return !!a && !!b && a.source === b.source && a.sourceId === b.sourceId;
}

/** A closed or half-open interval; both ends null when nothing is known. */
export interface NumRange {
    min: number | null;
    max: number | null;
}

export const NO_RANGE: NumRange = { min: null, max: null };

export function rangeOf(value: number | null): NumRange {
    return { min: value, max: value };
}

/** The range spanning every given range; nulls are skipped. */
export function rangeSpan(ranges: readonly NumRange[]): NumRange {
    let min: number | null = null;
    let max: number | null = null;
    for (const range of ranges) {
        if (range.min !== null && (min === null || range.min < min)) min = range.min;
        if (range.max !== null && (max === null || range.max > max)) max = range.max;
    }
    return { min, max };
}

/** A street address in parts, plus `text` as the site wrote it. `text` is set whenever anything is known. */
export interface Address {
    line1: string | null;
    unit: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    text: string | null;
}

export const NO_ADDRESS: Address = { line1: null, unit: null, city: null, state: null, zip: null, text: null };

export interface GeoPoint {
    lat: number;
    lng: number;
}

export type PropertyType = "apartment" | "house" | "condo" | "townhome" | "other";

export const PROPERTY_TYPES: readonly PropertyType[] = ["apartment", "house", "condo", "townhome", "other"];

/** Plural, as the Type filters name them. */
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
    apartment: "Apartments",
    house: "Houses",
    condo: "Condos",
    townhome: "Townhomes",
    other: "Other",
};

/** One unit inside a plan. `id` is the site's unit key, which a home listing for that unit shares. */
export interface Unit {
    id: string | null;
    name: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    rent: number | null;
    /** ISO date, "now", or null. */
    availableFrom: string | null;
    status: UnitStatus | null;
    /** The unit's own page, when it has one. */
    url: string | null;
}

export type UnitStatus = "for-rent" | "for-sale" | "off-market";

/** A floor plan: a layout offered in one or more units. */
export interface Plan {
    id: string | null;
    name: string | null;
    beds: number | null;
    baths: number | null;
    sqft: NumRange;
    rent: NumRange;
    availableUnits: number | null;
    units: Unit[];
}

export interface Fee {
    label: string;
    amount: number | null;
    text: string;
}

/** Everything the panel searches, filters, sorts and shows, in one shape for every site and kind. A home has single-value ranges. */
export interface CoreFields {
    /** The building or community name; a house has none. */
    name: string | null;
    address: Address;
    geo: GeoPoint | null;
    propertyType: PropertyType | null;
    rent: NumRange;
    beds: NumRange;
    baths: NumRange;
    sqft: NumRange;
    plans: Plan[];
    availableUnits: number | null;
    /** ISO date, "now", or null; for a building, the soonest of its units. */
    availableFrom: string | null;
    /** CDN URLs, largest size per photo. */
    photoUrls: string[];
    description: string | null;
    /** As the site labels them. */
    amenities: string[];
    /** What the listing has, in the shared filter vocabulary (sources/shared/filters.ts), in vocabulary order, no repeats. The source's plugin maps its page onto it at capture. */
    features: FeatureKey[];
    pets: string | null;
    fees: Fee[];
    contact: {
        phone: string | null;
        company: string | null;
    };
}

/** The site's own model of the listing, typed by that site's plugin. */
export interface SourceDetail {
    version: number;
    data: unknown;
}

/** Ids a source reads off a listing's detail for linking it to others on the same site. */
export interface LinkIds {
    /** Other ids this listing answers to besides `sourceId` (a building's lot id, as `lot:<id>`). */
    aliases: string[];
    /** Ids a home gives for the building it is in, matched against buildings' `sourceId` and `aliases`. */
    buildingIds: string[];
}

export const NO_LINK_IDS: LinkIds = { aliases: [], buildingIds: [] };

/** Everything the user types. A capture never writes these. */
export interface UserFields {
    status: ListingStatus;
    notes: string;
    links: string[];
}

export interface Listing extends ListingRef {
    id: string;
    url: string;
    kind: ListingKind;
    core: CoreFields;
    detail: SourceDetail;
    /** How the page was read: "hydration", "jsonld+dom", "dom". Shown in Details. */
    readMethod: string;
    /** True when only the page's layout could be read and the record is thinner than a full capture. */
    partial: boolean;
    user: UserFields;
    createdAt: number;
    updatedAt: number;
    /** Last successful capture; `updatedAt` also moves on user edits. */
    capturedAt: number;
}

/** What a source's content script hands back for one page. The worker adds `source`. */
export interface ListingCapture {
    sourceId: string;
    url: string;
    kind: ListingKind;
    core: CoreFields;
    detail: SourceDetail;
    readMethod: string;
    partial: boolean;
}

export interface Capture extends ListingCapture {
    source: SourceId;
}

/** Photo bytes, keyed by content hash. */
export interface Photo {
    /** SHA-256 of the blob, hex. */
    hash: string;
    blob: Blob;
    mimeType: string;
    sourceUrl: string;
    bytes: number;
    createdAt: number;
}

export interface ListingPhoto {
    id?: number;
    listingId: string;
    photoHash: string;
    order: number;
}

/** The cheapest option. */
export function headlinePrice(core: CoreFields): number | null {
    return core.rent.min ?? core.rent.max;
}

export function maxBeds(core: CoreFields): number | null {
    return core.beds.max ?? core.beds.min;
}

export function displayName(listing: Pick<Listing, "core" | "url">): string {
    return listing.core.name ?? listing.core.address.text ?? listing.url;
}

/** Brings a listing record written before schema v4 (database or backup) to the current shape. Mutates and returns it. */
export function upgradeListingRecord(row: Record<string, unknown>): Record<string, unknown> {
    // v3: `via` became `readMethod`; stored relations went.
    if (!("readMethod" in row) && typeof row["via"] === "string") row["readMethod"] = row["via"];
    for (const key of ["via", "propertyId", "buildingId", "answersTo", "buildingRefs"]) delete row[key];
    const data = (row["detail"] as { data?: unknown } | undefined)?.data;
    if (typeof data === "object" && data !== null) delete (data as Record<string, unknown>)["via"];
    // v4: `core.features`, empty until the listing is captured again.
    const core = row["core"];
    if (typeof core === "object" && core !== null && !Array.isArray((core as Record<string, unknown>)["features"])) (core as Record<string, unknown>)["features"] = [];
    return row;
}

/** A `core` that knows nothing, for extractors to fill in. */
export function emptyCore(): CoreFields {
    return {
        name: null,
        address: { ...NO_ADDRESS },
        geo: null,
        propertyType: null,
        rent: { ...NO_RANGE },
        beds: { ...NO_RANGE },
        baths: { ...NO_RANGE },
        sqft: { ...NO_RANGE },
        plans: [],
        availableUnits: null,
        availableFrom: null,
        photoUrls: [],
        description: null,
        amenities: [],
        features: [],
        pets: null,
        fees: [],
        contact: { phone: null, company: null },
    };
}
