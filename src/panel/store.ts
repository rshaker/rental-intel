import { effect, signal, type Signal } from "@preact/signals";
import { DEFAULT_FILTERS } from "./query";
import { parseCardState, parseFilters, parsePhotoMode, parseSort, parseTab } from "./schemas";

/**
 * What the panel remembers between openings, as signals kept in
 * `localStorage` under `intel.panel.*`: which tab is open, the filters and
 * the sort, the photo mode, whether the controls are folded, and per card
 * whether it is open, which of its sections are open and which photo it
 * shows. (scale.ts keeps one more, `intel.panel.scale`: a mirror of the
 * Size setting.) Each is read once through its schema (schemas.ts), which
 * trusts nothing it finds, and written on every change. The selection is
 * deliberately not persisted.
 */

export function readStored(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function store(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Nothing to do -- the choice just will not survive a panel reload.
    }
}

/** A signal kept in localStorage: read once, written on every change. */
export function persisted<T>(key: string, parse: (raw: string | null) => T, serialize: (value: T) => string = JSON.stringify): Signal<T> {
    const value = signal(parse(readStored(key)));
    let initial = true;
    effect(() => {
        const current = value.value;
        if (initial) {
            initial = false;
            return;
        }
        store(key, serialize(current));
    });
    return value;
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

export const filters = persisted("intel.panel.filters", parseFilters);
export const sort = persisted("intel.panel.sort", parseSort);
export const photoMode = persisted("intel.panel.photos", parsePhotoMode, (mode) => mode);
/** Whether the control panel under the title is shown. */
export const controlsOpen = persisted("intel.panel.controls", (raw) => raw !== "closed", (open) => (open ? "open" : "closed"));
export const tab = persisted("intel.panel.tab", parseTab, (name) => name);

export function resetFilters(): void {
    filters.value = { ...DEFAULT_FILTERS };
}

// ---------------------------------------------------------------------------
// Card state: which cards and sections are open, which photo each shows.
// A card's open state outlives the card, so a re-render never resets it.
// ---------------------------------------------------------------------------

export const cards = persisted("intel.panel.cards", parseCardState);

export function isCardOpen(id: string): boolean {
    return cards.value.expanded.includes(id);
}

export function setCardOpen(id: string, open: boolean): void {
    const { expanded } = cards.value;
    if (open === expanded.includes(id)) return;
    cards.value = { ...cards.value, expanded: open ? [...expanded, id] : expanded.filter((other) => other !== id) };
}

/** Section keys are "<listingId>:<section>". */
export function isSectionOpen(key: string): boolean {
    return cards.value.fields.includes(key);
}

export function setSectionsOpen(keys: readonly string[], open: boolean): void {
    const fields = new Set(cards.value.fields);
    for (const key of keys) if (open) fields.add(key);
    else fields.delete(key);
    cards.value = { ...cards.value, fields: [...fields] };
}

/** Opens or closes cards and the given sections of each, for the ⊞ ⊟ buttons. */
export function setCardsOpen(ids: readonly string[], open: boolean, sections: readonly string[]): void {
    const expanded = new Set(cards.value.expanded);
    const fields = new Set(cards.value.fields);
    for (const id of ids) {
        if (open) expanded.add(id);
        else expanded.delete(id);
        for (const name of sections) {
            if (open) fields.add(`${id}:${name}`);
            else fields.delete(`${id}:${name}`);
        }
    }
    cards.value = { ...cards.value, expanded: [...expanded], fields: [...fields] };
}

/** The photo an open card shows; kept across a collapse, since reopening where you left it is the nicer behaviour. */
export function photoIndexOf(id: string): number {
    return cards.value.photo[id] ?? 0;
}

export function setPhotoIndex(id: string, index: number): void {
    if (cards.value.photo[id] === index) return;
    cards.value = { ...cards.value, photo: { ...cards.value.photo, [id]: index } };
}

/** Forgets everything about some cards: they were deleted. */
export function forgetCards(ids: Iterable<string>): void {
    const gone = new Set(ids);
    const { expanded, fields, photo } = cards.value;
    cards.value = {
        expanded: expanded.filter((id) => !gone.has(id)),
        fields: fields.filter((key) => !gone.has(key.slice(0, key.indexOf(":")))),
        photo: Object.fromEntries(Object.entries(photo).filter(([id]) => !gone.has(id))),
    };
}

/** The database was replaced or emptied. */
export function forgetAllCards(): void {
    cards.value = { expanded: [], fields: [], photo: {} };
}
