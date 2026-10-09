import type { SearchFilterField, SearchFilters } from "../contract.js";

/**
 * The filters most sites' searches share, so a filter means the same thing
 * and reads the same on every form, and the readers a URL builder needs.
 * Pure: urls.ts imports this, and urls.ts is loaded by Node.
 */

export const RENT_MIN: SearchFilterField = { key: "rentMin", label: "Min", kind: "amount", group: "Rent" };
export const RENT_MAX: SearchFilterField = { key: "rentMax", label: "Max", kind: "amount", group: "Rent" };
export const BEDS: SearchFilterField = { key: "beds", label: "Beds", kind: "least", steps: [1, 2, 3, 4], group: "Rooms" };
export const BATHS: SearchFilterField = { key: "baths", label: "Baths", kind: "least", steps: [1, 2, 3], group: "Rooms" };

/** A positive whole number a filter is set to; null when it is absent or unusable. */
export function amount(filters: SearchFilters, key: string): number | null {
    const value = filters[key];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** Whether a flag is on. */
export function flag(filters: SearchFilters, key: string): boolean {
    return filters[key] === true;
}

/** The words a text filter holds, trimmed; null when it is absent or blank. */
export function words(filters: SearchFilters, key: string): string | null {
    const value = filters[key];
    return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;
}

/** Whether any filter is set to something a builder would use. */
export function anySet(filters: SearchFilters | undefined): boolean {
    return Object.keys(filters ?? {}).some((key) => amount(filters!, key) !== null || flag(filters!, key) || words(filters!, key) !== null);
}

/** A flag field, for a source's table of them. */
export function flagField(key: string, label: string, group: string, title?: string): SearchFilterField {
    return { key, label, kind: "flag", group, ...(title ? { title } : {}) };
}

/** A field as the form takes it, less whatever a source's own table adds beside it (a URL spelling). */
export function plainField({ key, label, kind, group, title }: SearchFilterField): SearchFilterField {
    return { key, label, kind, group, ...(title ? { title } : {}) };
}
