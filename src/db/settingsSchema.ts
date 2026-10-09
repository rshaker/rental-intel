import { LISTING_STATUSES, STATUS_LABELS, type ListingStatus } from "./types";

/**
 * Every setting, with its type, default, bounds, label and help. The
 * `settings` table is seeded from the defaults, the Options tab renders
 * itself from the entries, and a stored value that is missing or no longer
 * fits reads as its default, so adding a setting needs no migration.
 */

interface BaseSpec<T> {
    label: string;
    help: string;
    default: T;
}

export interface NumberSpec extends BaseSpec<number> {
    type: "number";
    min: number;
    max: number;
    step: number;
    /** Shown after the input: "s", "photos", … */
    unit: string;
}

export interface BooleanSpec extends BaseSpec<boolean> {
    type: "boolean";
}

export interface SelectSpec<T extends string = string> extends BaseSpec<T> {
    type: "select";
    options: readonly { value: T; label: string }[];
}

export type SettingSpec = NumberSpec | BooleanSpec | SelectSpec<string>;

/** The value type a spec declares. */
export type ValueOf<S> = S extends BaseSpec<infer T> ? T : never;

const number = (spec: Omit<NumberSpec, "type" | "step"> & { step?: number }): NumberSpec => ({ type: "number", step: 1, ...spec });
const boolean = (spec: Omit<BooleanSpec, "type">): BooleanSpec => ({ type: "boolean", ...spec });
const select = <T extends string>(spec: Omit<SelectSpec<T>, "type">): SelectSpec<T> => ({ type: "select", ...spec });

/** Whether `value` is something `spec` accepts. */
export function fitsSpec(spec: SettingSpec, value: unknown): boolean {
    switch (spec.type) {
        case "number":
            return typeof value === "number" && Number.isFinite(value) && value >= spec.min && value <= spec.max;
        case "boolean":
            return typeof value === "boolean";
        case "select":
            return typeof value === "string" && spec.options.some((option) => option.value === value);
    }
}

export interface SectionSpec {
    label: string;
    help: string;
}

/** Headings on the settings page, in display order. A setting's key starts with its section. */
export const SECTIONS: Record<string, SectionSpec> = {
    bulk: {
        label: "Loading lists",
        help: "How Load URLs walks the active tab through a list.",
    },
    search: {
        label: "Searching sites",
        help: "How the Search tab walks a site's pages of results.",
    },
    photos: {
        label: "Photos",
        help: "What is fetched from a site's image servers when a listing is saved.",
    },
    listings: {
        label: "Listings",
        help: "How a new listing starts out.",
    },
    details: {
        label: "Details rows",
        help: "Which rows an open card's Details section shows. A row whose value is unknown is left out regardless.",
    },
};

/** A Details row switch: on by default, named for the row. */
const detailRow = (label: string, help: string) => boolean({ label, help, default: true });

/** The registry. Keys are `<section>.<name>` and are what the table stores. */
export const SETTINGS = {
    "bulk.detectTimeout": number({
        label: "Wait for a page to confirm",
        help: "How long a page gets to load and be recognised before the run stops to ask you to look at the tab: answer the site's check there, or skip the page. The Search tab waits the same way.",
        default: 15,
        min: 3,
        max: 120,
        unit: "s",
    }),
    "bulk.pace": number({
        label: "Pause between listings",
        help: "A pause after one save before the next page is requested. Sites notice a tab that never pauses.",
        default: 2,
        min: 0,
        max: 60,
        unit: "s",
    }),
    "bulk.maxConsecutiveFailures": number({
        label: "Stop after failures in a row",
        help: "Pages skipped, or that could not be read, one after another: the list is probably not what it seemed, and stopping early lets you look at it.",
        default: 3,
        min: 1,
        max: 50,
        unit: "",
    }),
    "search.maxPages": number({
        label: "Pages of results to read",
        help: "A site splits a long result list over pages; a search reads them one after another, up to this many. 0 reads every page.",
        default: 0,
        min: 0,
        max: 100,
        unit: "pages",
    }),
    "search.pace": number({
        label: "Pause between pages",
        help: "A pause after one page of results before the next is requested. Sites notice a tab that never pauses.",
        default: 2,
        min: 0,
        max: 60,
        unit: "s",
    }),
    "photos.save": boolean({
        label: "Save photos",
        help: "Fetch and store a listing's photos with it. Off saves a lot of space and time; the details are kept either way.",
        default: true,
    }),
    "photos.limit": number({
        label: "Photos per listing",
        help: "Keep at most this many photos of a listing, in the order the site shows them. 0 keeps every photo -- a large building can have fifty or more.",
        default: 0,
        min: 0,
        max: 500,
        unit: "photos",
    }),
    "listings.defaultStatus": select<ListingStatus>({
        label: "Status for a new listing",
        help: "What a listing is marked as when it is first saved. Re-saving never changes a status you have set.",
        default: "none",
        options: LISTING_STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
    }),

    // The Details rows; the key after "details." is what Card.tsx checks.
    "details.address": detailRow("Address", "The street address, with a link to a map."),
    "details.location": detailRow("Location", "Latitude and longitude, when the site gives them."),
    "details.rent": detailRow("Rent", "The monthly rent, or the range across a building's plans."),
    "details.bedrooms": detailRow("Bedrooms", "The count, or the range across a building's plans."),
    "details.bathrooms": detailRow("Bathrooms", "The count, or the range across a building's plans."),
    "details.size": detailRow("Size", "Square footage, or the range across a building's plans."),
    "details.type": detailRow("Type", "Apartment, house, condo or townhome, as the site classifies it."),
    "details.features": detailRow("Features", "What the listing says it has, in the words the Features filter uses: pets, laundry, parking and the rest."),
    "details.availability": detailRow("Availability", "How many units are available and from when."),
    "details.plans": detailRow("Plans", "How many floor plans a building lists. The plans themselves have their own section."),
    "details.contact": detailRow("Contact", "The phone number and management company the listing gives."),
    "details.source": detailRow("Source", "The site and its own id for the listing."),
    "details.readMethod": detailRow("Source data", "Whether the record came from the site's own data or only from the page's layout."),
    "details.photos": detailRow("Photos", "How many photos the listing had when it was saved."),
    "details.saved": detailRow("Saved", "When the listing was first saved."),
    "details.updated": detailRow("Updated", "When anything about the listing last changed, including your own notes and status."),
    "details.captured": detailRow("Captured", "When the listing's details were last read from its page."),
};

export type SettingKey = keyof typeof SETTINGS;

/** The value type of one setting. */
export type SettingValue<K extends SettingKey> = ValueOf<(typeof SETTINGS)[K]>;

/** Every setting, resolved. What `getSettings()` hands back. */
export type Settings = { readonly [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** One row of the `settings` table; trust `value` only through `settingsFrom`. */
export interface SettingRow {
    key: string;
    value: unknown;
}

export function isSettingKey(key: string): key is SettingKey {
    return Object.hasOwn(SETTINGS, key);
}

export function defaultSettings(): Settings {
    const out: Record<string, unknown> = {};
    for (const key of SETTING_KEYS) out[key] = SETTINGS[key].default;
    return out as Settings;
}

/** What the table is seeded with. */
export function defaultRows(): SettingRow[] {
    return SETTING_KEYS.map((key) => ({ key, value: SETTINGS[key].default }));
}

/** Whether `value` is something `key`'s entry accepts. */
export function isValidValue<K extends SettingKey>(key: K, value: unknown): value is SettingValue<K> {
    return fitsSpec(SETTINGS[key], value);
}

/** Stored rows resolved against the registry: defaults, then every row whose key is known and whose value fits. */
export function settingsFrom(rows: readonly SettingRow[]): Settings {
    const out = defaultSettings() as Record<string, unknown>;
    for (const row of rows) {
        if (isSettingKey(row.key) && isValidValue(row.key, row.value)) out[row.key] = row.value;
    }
    return out as Settings;
}

/** The keys of one section, in registry order. */
export function keysInSection(section: string): SettingKey[] {
    return SETTING_KEYS.filter((key) => key.startsWith(`${section}.`));
}
