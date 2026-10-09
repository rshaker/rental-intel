import Dexie from "dexie";
import { db } from "./db";
import type { RawCapture, Snapshot } from "./types";

/** The capture history of a listing: its raw payload and its snapshots. */

/** The latest raw payload saved for a listing, for re-running a parser over it. */
export function getRawCapture(listingId: string): Promise<RawCapture | undefined> {
    return db.captures.get(listingId);
}

/** Every observation of a listing, oldest first. */
export function getSnapshots(listingId: string): Promise<Snapshot[]> {
    return db.snapshots
        .where("[listingId+timestamp]")
        .between([listingId, Dexie.minKey], [listingId, Dexie.maxKey])
        .toArray();
}
