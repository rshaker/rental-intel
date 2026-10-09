import * as z from "zod/mini";
import { LISTING_STATUSES } from "../db/types";
import type { SearchResult } from "../sources/contract";
import { DEFAULT_FILTERS, DEFAULT_SORT, NATURAL_DIR, SORT_KEYS, type ListingFilters, type SortSpec } from "./query";

/**
 * The shapes the panel keeps in localStorage, as schemas. localStorage hands
 * back whatever was last written, by any build, so nothing here trusts it:
 * each field falls back to its default on its own (`z.catch`), and a value
 * that is not even an object falls back whole. The types the rest of the
 * panel uses are declared beside the code that works with them (query.ts,
 * searchPane.ts); each schema is checked against its type here.
 */

function parseJson(raw: string | null): unknown {
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

const nonNegative = z.catch(z.nullable(z.number().check(z.gte(0))), null);

export const FiltersSchema = z.object({
    query: z.catch(z.string(), ""),
    kind: z.catch(z.enum(["all", "home", "building"]), "all"),
    source: z.catch(z.string().check(z.minLength(1)), "all"),
    priceMin: nonNegative,
    priceMax: nonNegative,
    bedsMin: nonNegative,
    bathsMin: nonNegative,
    status: z.catch(z.enum([...LISTING_STATUSES, "all"]), "all"),
});

export function parseFilters(raw: string | null): ListingFilters {
    const parsed = FiltersSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_FILTERS };
}

const SortSchema = z.object({
    key: z.enum(SORT_KEYS),
    dir: z.catch(z.optional(z.enum(["asc", "desc"])), undefined),
});

/** A key without a direction takes the key's natural one; an unknown key means the default sort. */
export function parseSort(raw: string | null): SortSpec {
    const parsed = SortSchema.safeParse(parseJson(raw));
    if (!parsed.success) return { ...DEFAULT_SORT };
    const { key, dir } = parsed.data;
    return { key, dir: dir ?? NATURAL_DIR[key] };
}

export const PANEL_TABS = ["listings", "search", "sources", "data", "options"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export function parseTab(raw: string | null): PanelTab {
    return z.catch(z.enum(PANEL_TABS), "listings").parse(raw);
}

/** How an open card shows its photos: one large photo with arrows, or a row of thumbnails. */
export type PhotoMode = "carousel" | "strip";

export function parsePhotoMode(raw: string | null): PhotoMode {
    return z.catch(z.enum(["carousel", "strip"]), "carousel").parse(raw);
}

// ---------------------------------------------------------------------------
// Card state: which cards and sections are open, which photo each shows
// ---------------------------------------------------------------------------

const CardStateSchema = z.object({
    expanded: z.catch(z.array(z.string()), []),
    fields: z.catch(z.array(z.string()), []),
    photo: z.catch(z.record(z.string(), z.int().check(z.gte(0))), {}),
});

export type CardState = z.infer<typeof CardStateSchema>;

export function parseCardState(raw: string | null): CardState {
    const parsed = CardStateSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : { expanded: [], fields: [], photo: {} };
}

// ---------------------------------------------------------------------------
// The Search tab: one state per site
// ---------------------------------------------------------------------------

const SearchResultSchema = z.object({
    title: z.string(),
    url: z.string(),
    priceText: z.nullable(z.string()),
    price: z.nullable(z.number()),
    factsText: z.nullable(z.string()),
    ref: z.nullable(z.object({ sourceId: z.string(), kind: z.nullable(z.enum(["home", "building"])) })),
});

/** What a filter can be set to: a number, `true`, or words. */
const FilterValueSchema = z.union([z.literal(true), z.number(), z.string().check(z.minLength(1))]);

const SiteSearchStateSchema = z.object({
    query: z.string(),
    status: z.catch(z.string(), ""),
    tone: z.catch(z.enum(["", "bad"]), ""),
    results: z.catch(z.nullable(z.array(SearchResultSchema)), null),
    /** The page the results were read from, once a run succeeded. */
    resultsUrl: z.catch(z.nullable(z.string()), null),
    /** The result list is folded away; the status line stays. */
    collapsed: z.catch(z.boolean(), false),
    /** What the filters are set to, by field key. A filter left alone is absent. */
    filters: z.catch(z.record(z.string(), FilterValueSchema), {}),
    /** The filters are unfolded. */
    filtersOpen: z.catch(z.boolean(), false),
});

/** The stored shape as the pane holds it: results typed as the contract's, filters as the form writes them. */
export type SiteSearchState = Omit<z.infer<typeof SiteSearchStateSchema>, "results" | "filters"> & {
    results: SearchResult[] | null;
    filters: Record<string, number | boolean | string>;
};

const SearchStatesSchema = z.record(z.string(), z.catch(z.nullable(SiteSearchStateSchema), null));

/** Every site's stored search state, by source id; a damaged entry is left out. */
export function parseSearchStates(raw: string | null): Map<string, SiteSearchState> {
    const parsed = SearchStatesSchema.safeParse(parseJson(raw));
    const states = new Map<string, SiteSearchState>();
    if (!parsed.success) return states;
    for (const [id, state] of Object.entries(parsed.data)) if (state) states.set(id, state);
    return states;
}
