import type { SearchFilterField, SearchFilters } from "../contract.js";

/**
 * The filters a site's search can offer, as one shared vocabulary in one
 * fixed order. A source contributes a spelling for the subset it can write
 * into a URL (see `fieldsFor`); the Search tab shows exactly that subset, in
 * this order, and names what the site does not offer. The same vocabulary
 * names what a captured listing has (`core.features`, see features.ts), so
 * the Listings tab filters by it too. A filter no shipped source spells is
 * not in this list. Pure; loaded by Node through urls.ts.
 */

function amountField<K extends string>(key: K, label: string, group: string) {
    return { key, label, kind: "amount", group } as const;
}
function minimumField<K extends string>(key: K, label: string, group: string, steps: readonly number[]) {
    return { key, label, kind: "minimum", group, steps } as const;
}
function flagField<K extends string>(key: K, label: string, group: string, title?: string) {
    return { key, label, kind: "flag", group, ...(title ? { title } : {}) } as const;
}
function textField<K extends string>(key: K, label: string, group: string, title: string) {
    return { key, label, kind: "text", group, title } as const;
}

export const FILTERS = [
    amountField("rentMin", "Min", "Rent"),
    amountField("rentMax", "Max", "Rent"),
    minimumField("beds", "Beds", "Rooms", [1, 2, 3, 4]),
    minimumField("baths", "Baths", "Rooms", [1, 2, 3]),
    flagField("typeApartments", "Apartments", "Type"),
    flagField("typeHouses", "Houses", "Type"),
    flagField("typeCondos", "Condos", "Type"),
    flagField("typeTownhomes", "Townhomes", "Type"),
    flagField("smallDogs", "Small dogs", "Pets"),
    flagField("largeDogs", "Large dogs", "Pets"),
    flagField("cats", "Cats", "Pets"),
    flagField("laundryInUnit", "In unit", "Laundry", "Washer & dryer in the unit"),
    flagField("laundryHookups", "Hookups", "Laundry", "Washer & dryer hookups"),
    flagField("laundryInBuilding", "In building", "Laundry", "Laundry facilities in the building"),
    flagField("dishwasher", "Dishwasher", "Unit"),
    flagField("airConditioning", "A/C", "Unit", "Air conditioning"),
    flagField("furnished", "Furnished", "Unit"),
    flagField("utilitiesIncluded", "Utilities incl.", "Unit", "Utilities included"),
    flagField("hardwood", "Hardwood", "Unit", "Hardwood floors"),
    flagField("parking", "Parking", "Building"),
    flagField("elevator", "Elevator", "Building"),
    flagField("accessible", "Accessible", "Building", "Wheelchair access"),
    flagField("gym", "Gym", "Building", "Fitness center"),
    flagField("pool", "Pool", "Building"),
    flagField("controlledAccess", "Controlled access", "Building"),
    flagField("incomeRestricted", "Income restricted", "Listing"),
    flagField("byOwner", "By owner", "Listing", "For rent by owner"),
    textField("keywords", "Keywords", "Keywords", "Words in the listing"),
] as const satisfies readonly SearchFilterField[];

export type FilterKey = (typeof FILTERS)[number]["key"];

/** The housing types: a search filter answered on a saved listing by `core.propertyType`, not a feature it carries. */
const TYPE_KEYS = ["typeApartments", "typeHouses", "typeCondos", "typeTownhomes"] as const;

type FlagKey = Extract<(typeof FILTERS)[number], { kind: "flag" }>["key"];

/** What a captured listing can say it has: every flag filter but the housing types and "by owner", which no listing page states. The value type of `core.features`. */
export type FeatureKey = Exclude<FlagKey, (typeof TYPE_KEYS)[number] | "byOwner">;

export const FEATURES: readonly SearchFilterField[] = FILTERS.filter((field) => field.kind === "flag" && !(TYPE_KEYS as readonly string[]).includes(field.key) && field.key !== "byOwner");

export const FEATURE_KEYS = FEATURES.map((field) => field.key) as readonly FeatureKey[];

/** The vocabulary filtered to `keys`, in vocabulary order: what a source's form shows. */
export function fieldsFor(keys: Iterable<FilterKey>): readonly SearchFilterField[] {
    const wanted = new Set<string>(keys);
    return FILTERS.filter((field) => wanted.has(field.key));
}

/** Fields in their groups, in the order given: one line of a form per group. */
export function grouped(fields: readonly SearchFilterField[]): Map<string, SearchFilterField[]> {
    const groups = new Map<string, SearchFilterField[]>();
    for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
    return groups;
}

/** A positive whole number a filter is set to; null when absent or unusable. */
export function amount(filters: SearchFilters, key: FilterKey): number | null {
    const value = filters[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function flag(filters: SearchFilters, key: FilterKey): boolean {
    return filters[key] === true;
}

/** The words a text filter holds, trimmed; null when absent or blank. */
export function words(filters: SearchFilters, key: FilterKey): string | null {
    const value = filters[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.replace(/\s+/g, " ") : null;
}

/** Whether any filter is set to something a builder would use. */
export function anySet(filters: SearchFilters | undefined): boolean {
    if (!filters) return false;
    return Object.keys(filters).some((key) => amount(filters, key as FilterKey) !== null || flag(filters, key as FilterKey) || words(filters, key as FilterKey) !== null);
}
