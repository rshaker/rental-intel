import { liveQuery } from "dexie";
import { signal, type ReadonlySignal } from "@preact/signals";
import { db } from "../db/db";
import { listListings } from "../db/listings";
import { defaultSettings, settingsFrom, type Settings } from "../db/settingsSchema";
import type { Listing } from "../db/types";
import { log, LogLevels } from "../lib/logging";

/**
 * The database as signals. Dexie's liveQuery re-runs a query whenever a
 * table it read changes, in this context or another of the same origin
 * (the worker's saves reach the panel), so a component that reads one of
 * these repaints by itself.
 */

export function live<T>(query: () => Promise<T> | T, initial: T): ReadonlySignal<T> {
    const value = signal(initial);
    liveQuery(query).subscribe({
        next: (next) => {
            value.value = next;
        },
        error: (error: unknown) => log(LogLevels.ERROR, "live query failed", error),
    });
    return value;
}

/** Every listing, most recently touched first; null until the first read lands. */
export const liveListings = live<Listing[] | null>(() => listListings(), null);

/** Every setting, resolved against its default. */
export const liveSettings = live<Settings>(async () => settingsFrom(await db.settings.toArray()), defaultSettings());

/** How many photo blobs are stored, for the Data tab's export size. */
export const livePhotoCount = live(() => db.photos.count(), 0);
