import { displayName, headlinePrice, maxBeds, NO_LINK_IDS, type LinkIds, type Listing, type ListingKind, type ListingStatus, type PropertyType } from "../db/types";
import { sameSubject } from "../lib/match";
import type { FeatureKey } from "../sources/shared/filters";

/** Everything the panel does to the list before showing it: search, filter, sort, float the active one, relate, and shift-click ranges. Pure functions over `Listing[]`. */

// Sort

export type SortKey = "updatedAt" | "capturedAt" | "createdAt" | "price" | "beds" | "sqft" | "name" | "address" | "source";
export type SortDir = "asc" | "desc";

export interface SortSpec {
    key: SortKey;
    dir: SortDir;
}

export const SORT_KEYS: readonly SortKey[] = ["updatedAt", "capturedAt", "createdAt", "price", "beds", "sqft", "name", "address", "source"];

export const SORT_LABELS: Record<SortKey, string> = {
    updatedAt: "Last updated",
    capturedAt: "Date captured",
    createdAt: "Date saved",
    price: "Rent",
    beds: "Bedrooms",
    sqft: "Size",
    name: "Name",
    address: "Address",
    source: "Site",
};

/** The direction a key is first shown in: dates newest first, everything else ascending. */
export const NATURAL_DIR: Record<SortKey, SortDir> = {
    updatedAt: "desc",
    capturedAt: "desc",
    createdAt: "desc",
    price: "asc",
    beds: "asc",
    sqft: "asc",
    name: "asc",
    address: "asc",
    source: "asc",
};

/** What the panel showed before sorting existed: most recently touched first. */
export const DEFAULT_SORT: SortSpec = { key: "updatedAt", dir: "desc" };

type SortValue = number | string | null;

function sortValue(listing: Listing, key: SortKey): SortValue {
    switch (key) {
        case "updatedAt":
            return listing.updatedAt;
        case "capturedAt":
            return listing.capturedAt;
        case "createdAt":
            return listing.createdAt;
        case "price":
            return headlinePrice(listing.core);
        case "beds":
            return maxBeds(listing.core);
        case "sqft":
            return listing.core.sqft.max ?? listing.core.sqft.min;
        case "name":
            return displayName(listing);
        case "address":
            return listing.core.address.text;
        case "source":
            return listing.source;
    }
}

function compareValues(a: number | string, b: number | string): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

/** Deterministic order for equal keys, so a re-render never reshuffles rows mid shift-select. */
function tiebreak(a: Listing, b: Listing): number {
    return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A new array; the input is left alone. */
export function sortListings(listings: readonly Listing[], sort: SortSpec): Listing[] {
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...listings].sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        // Nulls last in both directions.
        if (va === null || vb === null) {
            if (va === vb) return tiebreak(a, b);
            return va === null ? 1 : -1;
        }
        return sign * compareValues(va, vb) || tiebreak(a, b);
    });
}

// Search

/** Everything a listing can be found by, as one lowercase string: what the site said and what the user wrote. */
export function searchText(listing: Listing, sourceLabel: string): string {
    const { core, user } = listing;
    const parts: (string | null)[] = [
        core.name,
        core.address.text,
        core.address.city,
        core.address.zip,
        core.propertyType,
        core.description,
        core.pets,
        core.contact.company,
        core.contact.phone,
        sourceLabel,
        listing.source,
        listing.kind,
        user.status,
        user.notes,
        ...core.amenities,
        ...core.fees.map((fee) => `${fee.label} ${fee.text}`),
        ...core.plans.flatMap((plan) => [plan.name, ...plan.units.map((unit) => unit.name)]),
        ...user.links,
    ];
    return parts
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n")
        .toLowerCase();
}

/** The words of a query, lowercase; a quoted run is one term. */
export function searchTerms(query: string): string[] {
    const terms: string[] = [];
    for (const match of query.toLowerCase().matchAll(/"([^"]*)"|(\S+)/g)) {
        const term = (match[1] ?? match[2] ?? "").trim();
        if (term) terms.push(term);
    }
    return terms;
}

/** Every term must appear somewhere in the text. */
export function matchesSearch(text: string, terms: readonly string[]): boolean {
    return terms.every((term) => text.includes(term));
}

// Filter

export interface ListingFilters {
    /** Free text; see searchTerms. */
    query: string;
    kind: ListingKind | "all";
    /** A source id, or "all". */
    source: string;
    propertyType: PropertyType | "all";
    priceMin: number | null;
    priceMax: number | null;
    bedsMin: number | null;
    bathsMin: number | null;
    /** Every one of these must be in the listing's `core.features`. */
    features: FeatureKey[];
    status: ListingStatus | "all";
}

export const DEFAULT_FILTERS: ListingFilters = {
    query: "",
    kind: "all",
    source: "all",
    propertyType: "all",
    priceMin: null,
    priceMax: null,
    bedsMin: null,
    bathsMin: null,
    features: [],
    status: "all",
};

/** How many filters are narrowing the list. Rent min and max count as one, each feature as one; the search box, kind and site are not counted. */
export function activeFilterCount(filters: ListingFilters): number {
    return (
        [
            filters.propertyType !== "all",
            filters.priceMin !== null || filters.priceMax !== null,
            filters.bedsMin !== null,
            filters.bathsMin !== null,
            filters.status !== "all",
        ].filter(Boolean).length + filters.features.length
    );
}

export function isDefaultFilters(filters: ListingFilters): boolean {
    return activeFilterCount(filters) === 0 && filters.kind === "all" && filters.source === "all" && filters.query.trim() === "";
}

/** A listing with no value for a bound is excluded once the bound is set. A building matches when any of its plans could: cheapest rent against the maximum, largest plan against the minimum rooms. */
export function matchesFilters(listing: Listing, filters: ListingFilters, sourceLabel: string, terms?: readonly string[]): boolean {
    if (filters.kind !== "all" && listing.kind !== filters.kind) return false;
    if (filters.source !== "all" && listing.source !== filters.source) return false;
    if (filters.status !== "all" && listing.user.status !== filters.status) return false;

    const { core } = listing;
    if (filters.propertyType !== "all" && core.propertyType !== filters.propertyType) return false;
    if (!filters.features.every((feature) => core.features.includes(feature))) return false;
    if (filters.priceMin !== null || filters.priceMax !== null) {
        const low = core.rent.min ?? core.rent.max;
        const high = core.rent.max ?? core.rent.min;
        if (low === null || high === null) return false;
        if (filters.priceMin !== null && high < filters.priceMin) return false;
        if (filters.priceMax !== null && low > filters.priceMax) return false;
    }

    if (filters.bedsMin !== null) {
        const beds = maxBeds(core);
        if (beds === null || beds < filters.bedsMin) return false;
    }

    if (filters.bathsMin !== null) {
        const baths = core.baths.max ?? core.baths.min;
        if (baths === null || baths < filters.bathsMin) return false;
    }

    const words = terms ?? searchTerms(filters.query);
    if (words.length && !matchesSearch(searchText(listing, sourceLabel), words)) return false;

    return true;
}

export function isDefaultSort(sort: SortSpec): boolean {
    return sort.key === DEFAULT_SORT.key && sort.dir === DEFAULT_SORT.dir;
}

/** Filter, sort, then, only in the default view, float the active tab's listing to the top. A chosen sort is honoured literally. */
export function orderForDisplay(
    listings: readonly Listing[],
    filters: ListingFilters,
    sort: SortSpec,
    activeId: string | null,
    labelOf: (source: string) => string,
): Listing[] {
    const terms = searchTerms(filters.query);
    const sorted = sortListings(
        listings.filter((listing) => matchesFilters(listing, filters, labelOf(listing.source), terms)),
        sort,
    );
    if (activeId === null || !isDefaultSort(sort)) return sorted;
    return [...sorted.filter((l) => l.id === activeId), ...sorted.filter((l) => l.id !== activeId)];
}

// Relations, computed over the list: the same place on another site, and a home that is a unit of a saved building on the same site.

export interface Relations {
    /** Other listings of the same place, by listing id, in list order. */
    siblings: Map<string, Listing[]>;
    /** Saved home listings of a building's units, by the building's id. */
    unitsOf: Map<string, Listing[]>;
    /** The saved building a home is a unit of, by the home's id. */
    buildingOf: Map<string, Listing>;
    /** Every listing by id. */
    byId: Map<string, Listing>;
}

/** The ids a source reads off a listing's detail for linking (SourceDescriptor.linkIds). */
export type LinkIdsOf = (listing: Listing) => LinkIds;

/** Whether two different listings of the same kind describe the same place. */
export function samePlace(a: Listing, b: Listing): boolean {
    return a.id !== b.id && a.kind === b.kind && sameSubject(a.core, b.core);
}

/** Whether `home` is a unit of `building`: the building lists the home's id among its units, or the home names the building by its id or an alias. */
export function isUnitOf(home: Listing, building: Listing, linkIdsOf: LinkIdsOf): boolean {
    if (home.source !== building.source || home.kind !== "home" || building.kind !== "building") return false;
    for (const plan of building.core.plans) for (const unit of plan.units) if (unit.id === home.sourceId) return true;
    const keys = [building.sourceId, ...linkIdsOf(building).aliases];
    return linkIdsOf(home).buildingIds.some((id) => keys.includes(id));
}

export function relate(listings: readonly Listing[], linkIdsOf: LinkIdsOf = () => NO_LINK_IDS): Relations {
    const cache = new Map<string, LinkIds>();
    const ids: LinkIdsOf = (listing) => {
        let found = cache.get(listing.id);
        if (!found) cache.set(listing.id, (found = linkIdsOf(listing)));
        return found;
    };
    const byId = new Map(listings.map((listing) => [listing.id, listing]));
    const siblings = new Map<string, Listing[]>();
    for (const listing of listings) {
        const others = listings.filter((other) => samePlace(listing, other));
        if (others.length) siblings.set(listing.id, others);
    }
    const buildings = listings.filter((listing) => listing.kind === "building");
    const unitsOf = new Map<string, Listing[]>();
    const buildingOf = new Map<string, Listing>();
    for (const home of listings) {
        if (home.kind !== "home") continue;
        const building = buildings.find((candidate) => isUnitOf(home, candidate, ids));
        if (!building) continue;
        buildingOf.set(home.id, building);
        unitsOf.set(building.id, [...(unitsOf.get(building.id) ?? []), home]);
    }
    return { siblings, unitsOf, buildingOf, byId };
}

// Selection

/** Ids from the anchor to the target inclusive, in on-screen order. An anchor that left the screen degrades to just the target. */
export function rangeBetween(orderedIds: readonly string[], anchorId: string, targetId: string): string[] {
    const target = orderedIds.indexOf(targetId);
    if (target === -1) return [];
    const anchor = orderedIds.indexOf(anchorId);
    if (anchor === -1) return [targetId];
    const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
    return orderedIds.slice(from, to + 1);
}

