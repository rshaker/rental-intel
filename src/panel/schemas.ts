import { LISTING_STATUSES, PROPERTY_TYPES } from "../db/types";
import type { SearchResult } from "../sources/contract";
import { FEATURE_KEYS } from "../sources/shared/filters";
import { DEFAULT_FILTERS, DEFAULT_SORT, NATURAL_DIR, SORT_KEYS, type ListingFilters, type SortSpec } from "./query";

/**
 * The shapes the panel keeps in localStorage. localStorage hands back whatever
 * was last written, by any build, so nothing here trusts it: each field falls
 * back to its default on its own, and a value that is not even an object falls
 * back whole.
 */

type Guard<T> = (value: unknown) => value is T;
type Row = Record<string, unknown>;

function parseJson(raw: string | null): unknown {
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

const isRecord: Guard<Row> = (value): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const isString: Guard<string> = (value): value is string => typeof value === "string";
const isNonNegative: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
const oneOf =
    <T extends string>(values: readonly T[]): Guard<T> =>
    (value): value is T =>
        typeof value === "string" && (values as readonly string[]).includes(value);
const nullable =
    <T>(guard: Guard<T>): Guard<T | null> =>
    (value): value is T | null =>
        value === null || guard(value);
const arrayOf =
    <T>(guard: Guard<T>): Guard<T[]> =>
    (value): value is T[] =>
        Array.isArray(value) && value.every(guard);

/** `row[key]` when `guard` accepts it, else `fallback`. */
function field<T>(row: Row, key: string, guard: Guard<T>, fallback: T): T {
    const value = row[key];
    return guard(value) ? value : fallback;
}

/** The entries of `row` whose values `guard` accepts. */
function entriesOf<T>(row: Row, guard: Guard<T>): Record<string, T> {
    return Object.fromEntries(Object.entries(row).filter((entry): entry is [string, T] => guard(entry[1])));
}

// View state

export function parseFilters(raw: string | null): ListingFilters {
    const row = parseJson(raw);
    if (!isRecord(row)) return { ...DEFAULT_FILTERS };
    return {
        query: field(row, "query", isString, ""),
        kind: field(row, "kind", oneOf(["all", "home", "building"] as const), "all"),
        source: field(row, "source", (value): value is string => isString(value) && value.length > 0, "all"),
        propertyType: field(row, "propertyType", oneOf([...PROPERTY_TYPES, "all"] as const), "all"),
        priceMin: field(row, "priceMin", nullable(isNonNegative), null),
        priceMax: field(row, "priceMax", nullable(isNonNegative), null),
        bedsMin: field(row, "bedsMin", nullable(isNonNegative), null),
        bathsMin: field(row, "bathsMin", nullable(isNonNegative), null),
        features: [...new Set(field(row, "features", arrayOf(oneOf(FEATURE_KEYS)), []))],
        status: field(row, "status", oneOf([...LISTING_STATUSES, "all"] as const), "all"),
    };
}

const isSortKey = oneOf(SORT_KEYS);

/** A key without a direction takes the key's natural one; an unknown key means the default sort. */
export function parseSort(raw: string | null): SortSpec {
    const row = parseJson(raw);
    if (!isRecord(row)) return { ...DEFAULT_SORT };
    const key = row["key"];
    if (!isSortKey(key)) return { ...DEFAULT_SORT };
    return { key, dir: field(row, "dir", oneOf(["asc", "desc"] as const), NATURAL_DIR[key]) };
}

/** How an open card shows its photos: one large photo with arrows, or a row of thumbnails. */
export type PhotoMode = "carousel" | "strip";

export function parsePhotoMode(raw: string | null): PhotoMode {
    return oneOf(["carousel", "strip"] as const)(raw) ? raw : "strip";
}

// Card state: which cards and sections are open, which photo each shows

export interface CardState {
    expanded: string[];
    fields: string[];
    photo: Record<string, number>;
}

export function parseCardState(raw: string | null): CardState {
    const row = parseJson(raw);
    if (!isRecord(row)) return { expanded: [], fields: [], photo: {} };
    return {
        expanded: field(row, "expanded", arrayOf(isString), []),
        fields: field(row, "fields", arrayOf(isString), []),
        photo: entriesOf(field(row, "photo", isRecord, {}), (value): value is number => isNonNegative(value) && Number.isInteger(value)),
    };
}

// The Search tab: one state per site

export interface SiteSearchState {
    query: string;
    status: string;
    tone: "" | "bad";
    results: SearchResult[] | null;
    /** The page the results were read from, once a run succeeded. */
    resultsUrl: string | null;
    /** The result list is folded away; the status line stays. */
    collapsed: boolean;
    /** What the filters are set to, by field key. A filter left alone is absent. */
    filters: Record<string, number | boolean | string>;
    /** The filters are unfolded. */
    filtersOpen: boolean;
    /** Which of the results the list shows: every one, or the homes or the buildings among them. */
    show: "all" | "home" | "building";
}

/** A stored result; one written before results carried a kind has none. */
const isSearchResult: Guard<Omit<SearchResult, "kind"> & { kind?: SearchResult["kind"] }> = (value): value is Omit<SearchResult, "kind"> & { kind?: SearchResult["kind"] } =>
    isRecord(value) && isString(value["title"]) && isString(value["url"]) && nullable(isString)(value["priceText"]) && nullable(isString)(value["factsText"]) && (value["kind"] === undefined || nullable(oneOf(["home", "building"] as const))(value["kind"]));
const isFilterValue: Guard<number | boolean | string> = (value): value is number | boolean | string => typeof value === "number" || typeof value === "boolean" || typeof value === "string";

/** Every site's stored search state, by source id; an entry without a query string is left out. */
export function parseSearchStates(raw: string | null): Map<string, SiteSearchState> {
    const states = new Map<string, SiteSearchState>();
    const rows = parseJson(raw);
    if (!isRecord(rows)) return states;
    for (const [id, row] of Object.entries(rows)) {
        if (!isRecord(row) || !isString(row["query"])) continue;
        states.set(id, {
            query: row["query"],
            status: field(row, "status", isString, ""),
            tone: field(row, "tone", oneOf(["", "bad"] as const), ""),
            results: field(row, "results", nullable(arrayOf(isSearchResult)), null)?.map((result) => ({ ...result, kind: result.kind ?? null })) ?? null,
            resultsUrl: field(row, "resultsUrl", nullable(isString), null),
            collapsed: field(row, "collapsed", isBoolean, false),
            filters: entriesOf(field(row, "filters", isRecord, {}), isFilterValue),
            filtersOpen: field(row, "filtersOpen", isBoolean, false),
            show: field(row, "show", oneOf(["all", "home", "building"] as const), "all"),
        });
    }
    return states;
}
