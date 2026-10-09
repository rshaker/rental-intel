import type { SourceId } from "../sources/descriptors.js";

/**
 * Record shapes for the listing database.
 *
 * Three rules drive this file:
 *   1. A listing is what one site says about one thing it lists. It has the
 *      site's own id, a `core` that looks the same whatever the site or the
 *      kind of thing, and a `detail` the site's plugin alone understands.
 *      Notes, status, photos and history are blind to both.
 *   2. Listings relate through their attributes -- two listings share an
 *      address, sit at the same coordinates -- never through a parent/child
 *      structure. The table is flat; grouping is a query. (A later version
 *      will add a `properties` table that a listing points at; see
 *      ARCHITECTURE.md, "Evolution path".)
 *   3. Captured fields and user-authored fields live in separate sub-objects,
 *      so a re-capture can replace `core` and `detail` wholesale without ever
 *      touching `user`.
 */

/**
 * What a listing is about. A `home` is one dwelling -- a house, a condo, one
 * unit with a page of its own. A `building` is a multi-unit listing whose
 * page describes floor plans and units that have no pages of their own.
 */
export type ListingKind = "home" | "building";

export const LISTING_KINDS: readonly ListingKind[] = ["home", "building"];

/** `none` is a real value, not a missing one: "I have not decided", which is what a fresh save is. */
export type ListingStatus = "none" | "interested" | "not-interested" | "scheduled" | "visited" | "applied" | "rejected";

/** Every status, in the order the status menus list them. */
export const LISTING_STATUSES: readonly ListingStatus[] = [
    "none",
    "interested",
    "not-interested",
    "scheduled",
    "visited",
    "applied",
    "rejected",
];

export const STATUS_LABELS: Record<ListingStatus, string> = {
    none: "None",
    interested: "Interested",
    "not-interested": "Not interested",
    scheduled: "Scheduled",
    visited: "Visited",
    applied: "Applied",
    rejected: "Rejected",
};

/**
 * One listing, named the way the site names it. `sourceId` is the site's own
 * key, lifted verbatim from the URL or the page -- nothing here is ours. This
 * is the identity messages carry between contexts and the key the
 * `[source+sourceId]` index is looked up by.
 */
export interface ListingRef {
    source: SourceId;
    sourceId: string;
}

export function sameRef(a: ListingRef | null | undefined, b: ListingRef | null | undefined): boolean {
    return !!a && !!b && a.source === b.source && a.sourceId === b.sourceId;
}

/** A closed or half-open interval. Both ends null means nothing is known. */
export interface NumRange {
    min: number | null;
    max: number | null;
}

export const NO_RANGE: NumRange = { min: null, max: null };

/** A range that is one number, the shape a home's rent or bedroom count takes. */
export function rangeOf(value: number | null): NumRange {
    return { min: value, max: value };
}

/** The range spanning every given range. Nulls are skipped, not treated as zero. */
export function rangeSpan(ranges: readonly NumRange[]): NumRange {
    let min: number | null = null;
    let max: number | null = null;
    for (const range of ranges) {
        if (range.min !== null && (min === null || range.min < min)) min = range.min;
        if (range.max !== null && (max === null || range.max > max)) max = range.max;
    }
    return { min, max };
}

/**
 * A street address in parts, plus the whole thing as the site wrote it.
 * `text` is set whenever anything at all is known, so display code can rely
 * on it; the parts are for matching and search and may be missing.
 */
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

/**
 * One unit inside a floor plan, as the building's page lists it. Units are
 * kept only here; a unit becomes a listing of its own when it has a page of
 * its own and that page is saved. `id` is whatever the site keys units by,
 * and is the attribute a home listing for that unit would share.
 */
export interface Unit {
    id: string | null;
    /** The site's label: "Unit 2065", "B-204". */
    name: string | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    rent: number | null;
    /** ISO date, "now", or null when the site did not say. */
    availableFrom: string | null;
    /**
     * What the site is doing with this unit. A unit from a rental feed is for
     * rent by construction; a unit a site merely knows of (Zillow's small
     * buildings list every home record at the lot) may be for sale or off the
     * market. Null when the site did not say.
     */
    status: UnitStatus | null;
    /** The unit's own page, when it has one. */
    url: string | null;
}

export type UnitStatus = "for-rent" | "for-sale" | "off-market";

/** A floor plan (Zillow) or model (apartments.com): a layout offered in one or more units. */
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
    /** The fee as the site wrote it, for when `amount` does not tell the story ("$50 per pet per month"). */
    text: string;
}

/**
 * Everything the panel searches, filters, sorts and shows, in one shape for
 * every site and every kind. Ranges rather than a per-kind union: a home is a
 * listing whose ranges have one value and whose `plans` is empty or has one
 * entry, so nothing downstream has to branch on what the listing is about.
 */
export interface CoreFields {
    /** The building or community's name. A house has none. */
    name: string | null;
    address: Address;
    geo: GeoPoint | null;
    propertyType: PropertyType | null;
    /** Monthly base rent. */
    rent: NumRange;
    beds: NumRange;
    baths: NumRange;
    sqft: NumRange;
    plans: Plan[];
    availableUnits: number | null;
    /** ISO date, "now", or null. For a building, the soonest of its units. */
    availableFrom: string | null;
    /** CDN URLs, largest size per photo. The bytes are fetched into `photos`; these rot when a listing is pulled. */
    photoUrls: string[];
    description: string | null;
    amenities: string[];
    pets: string | null;
    fees: Fee[];
    contact: {
        phone: string | null;
        /** Management company or landlord, as named on the page. */
        company: string | null;
    };
}

/** The site's own model of the listing, typed by that site's plugin. */
export interface SourceDetail {
    /** The plugin's own schema version for `data`, bumped when its shape changes. */
    version: number;
    data: unknown;
}

/**
 * Ids a source's `detail` gives for relating listings on the same site,
 * beyond the listing's own `sourceId` (see `relations` on SourceDescriptor
 * and db/relations.ts).
 */
export interface RelationFields {
    /** Ids this listing answers to besides `sourceId`: a building's lot id, as `lot:<id>`. */
    answersTo: string[];
    /** Ids a home gives for the building it is in, matched against buildings' `sourceId` and `answersTo`. */
    buildingRefs: string[];
}

/** Everything the user types. A capture must never write to these. */
export interface UserFields {
    status: ListingStatus;
    notes: string;
    /** Other URLs for the same place: other sites, the leasing company, a map pin. */
    links: string[];
}

export interface Listing extends ListingRef, RelationFields {
    /** Opaque and ours. Carries no meaning; look listings up by `source` + `sourceId`, not by parsing this. */
    id: string;
    /** The listing's canonical page. */
    url: string;
    kind: ListingKind;
    core: CoreFields;
    detail: SourceDetail;
    /** How the page was read: "hydration", "jsonld+dom", "dom". Free text, for the Details section. */
    via: string;
    /** True when the reader had to fall back to the page's layout and the record is thinner than a full capture. */
    partial: boolean;
    /**
     * The place this listing is about, shared with every listing of the same
     * kind that describes the same place on another site (db/relations.ts
     * decides, at save time). Opaque, like `id`. Indexed.
     */
    propertyId: string;
    /** The saved building this home is a unit of, by listing id. Null for a building, or a home whose building is not saved. Indexed. */
    buildingId: string | null;
    user: UserFields;
    createdAt: number;
    updatedAt: number;
    /** Last successful capture. Distinct from `updatedAt`, which notes edits too. */
    capturedAt: number;
}

/**
 * What a source's content script hands back for one page. The worker adds
 * the `source` it came from; the plugin does not name itself twice.
 */
export interface ListingCapture {
    sourceId: string;
    url: string;
    kind: ListingKind;
    core: CoreFields;
    detail: SourceDetail;
    via: string;
    partial: boolean;
    /** The extractor's whole input -- payload blocks, or a DOM-derived record -- kept so parser bugs can be re-run over old captures. */
    raw: unknown;
}

export interface Capture extends ListingCapture {
    source: SourceId;
}

/** The latest raw payload of a listing. One row per listing, replaced on every capture. */
export interface RawCapture {
    listingId: string;
    capturedAt: number;
    url: string;
    payload: unknown;
}

/** Photo bytes, deduped by content hash so re-captures cost nothing. */
export interface Photo {
    /** SHA-256 of the blob, hex encoded. */
    hash: string;
    blob: Blob;
    mimeType: string;
    /** The CDN URL it came from, for debugging only. */
    sourceUrl: string;
    bytes: number;
    createdAt: number;
}

/** Join table -- photos are addressed by hash and may be shared between listings. */
export interface ListingPhoto {
    id?: number;
    listingId: string;
    photoHash: string;
    /** Display order within the listing. */
    order: number;
}

/** One observation of a listing: the numbers a price history is built from. Small on purpose. */
export interface Snapshot {
    id?: number;
    listingId: string;
    timestamp: number;
    rentMin: number | null;
    rentMax: number | null;
    availableUnits: number | null;
    status: ListingStatus;
}

// ---------------------------------------------------------------------------
// Derived values every context agrees on
// ---------------------------------------------------------------------------

/** The one number the capture row and the snapshot compare: the cheapest option. */
export function headlinePrice(core: CoreFields): number | null {
    return core.rent.min ?? core.rent.max;
}

/** The most bedrooms on offer. */
export function maxBeds(core: CoreFields): number | null {
    return core.beds.max ?? core.beds.min;
}

/** Name, else address, else the page's URL. */
export function displayName(listing: Pick<Listing, "core" | "url">): string {
    return listing.core.name ?? listing.core.address.text ?? listing.url;
}

/** The `core` of a listing that knows nothing, for extractors to fill in from. */
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
        pets: null,
        fees: [],
        contact: { phone: null, company: null },
    };
}
