import { signal } from "@preact/signals";
import type { Listing } from "../db/types";
import { rangeBetween } from "./query";

/**
 * The selection: which cards are ticked, where a shift-range starts, and
 * whether Delete is awaiting confirmation. Only ever covers what is on
 * screen; the list prunes it when a filter or sort hides a card. Not
 * persisted.
 */

export const selected = signal<ReadonlySet<string>>(new Set());
/** The last plain-clicked card: where a shift-click range starts. */
export const anchorId = signal<string | null>(null);
export const confirmingDelete = signal(false);
/** Ids in the order currently on screen -- what shift-ranges and select-all operate over. */
export const visibleIds = signal<readonly string[]>([]);

export function clearSelection(): void {
    selected.value = new Set();
    anchorId.value = null;
    confirmingDelete.value = false;
}

export function selectAllVisible(): void {
    selected.value = new Set(visibleIds.value);
}

/**
 * The master checkbox's menu: the selection becomes exactly the on-screen
 * listings matching the choice. `all` and `none` are the two ends; a kind or
 * a status picks a subset, as Gmail's Read / Starred do.
 */
export function selectWhere(choice: string, byId: ReadonlyMap<string, Listing>): void {
    const keep = (listing: Listing): boolean =>
        choice === "all" ? true
        : choice === "none" ? false
        : choice.startsWith("status:") ? listing.user.status === choice.slice("status:".length)
        : listing.kind === choice;
    const next = new Set<string>();
    for (const id of visibleIds.value) {
        const listing = byId.get(id);
        if (listing && keep(listing)) next.add(id);
    }
    selected.value = next;
    anchorId.value = null;
}

/** A click on a card's checkbox. Shift extends from the anchor, additive, with the anchor staying put. */
export function toggleSelected(id: string, shift: boolean): void {
    const next = new Set(selected.value);
    if (shift && anchorId.value !== null) {
        for (const rangeId of rangeBetween(visibleIds.value, anchorId.value, id)) next.add(rangeId);
    } else {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchorId.value = id;
    }
    selected.value = next;
}

/** Drops whatever a filter or sort change has just hidden: Delete must never touch it. */
export function pruneSelection(visible: ReadonlySet<string>): void {
    if ([...selected.value].every((id) => visible.has(id)) && (anchorId.value === null || visible.has(anchorId.value))) return;
    selected.value = new Set([...selected.value].filter((id) => visible.has(id)));
    if (anchorId.value !== null && !visible.has(anchorId.value)) anchorId.value = null;
}
