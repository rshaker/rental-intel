import Dexie, { type EntityTable } from "dexie";
import { placeAll, relationFields } from "./relations";
import { defaultRows, type SettingRow } from "./settingsSchema";
import type { Listing, ListingPhoto, Photo, RawCapture, Snapshot } from "./types";

/**
 * The database lives in the extension origin, which means the service worker and
 * the side panel open the same IndexedDB. Content scripts never touch it -- they
 * extract and message, nothing more.
 *
 * Nested keypaths ("user.status") are indexed directly by Dexie; compound indexes
 * are in brackets; a `*` prefix indexes each element of an array. Bump
 * `version(n)` and add an upgrade step when this changes.
 */
class RentalIntelDatabase extends Dexie {
    declare listings: EntityTable<Listing, "id">;
    declare captures: EntityTable<RawCapture, "listingId">;
    declare snapshots: EntityTable<Snapshot, "id">;
    declare photos: EntityTable<Photo, "hash">;
    declare listingPhotos: EntityTable<ListingPhoto, "id">;
    declare settings: EntityTable<SettingRow, "key">;

    constructor() {
        super("rental-intel");

        this.version(1).stores({
            listings: "id, [source+sourceId], source, kind, updatedAt, capturedAt, user.status",
            captures: "listingId",
            snapshots: "++id, listingId, timestamp, [listingId+timestamp]",
            photos: "hash, createdAt",
            listingPhotos: "++id, listingId, photoHash, [listingId+order]",
            settings: "key",
        });

        // v2: relations stored on the listing (db/relations.ts). Existing rows
        // get their relation ids from their detail and are placed once, in
        // the order they were saved.
        this.version(2)
            .stores({
                listings: "id, [source+sourceId], source, kind, updatedAt, capturedAt, user.status, propertyId, buildingId, *answersTo, *buildingRefs",
            })
            .upgrade(async (tx) => {
                const table = tx.table<Listing, string>("listings");
                const listings = (await table.toArray()).map((listing) => ({ ...listing, ...relationFields(listing.source, listing.detail) })).sort((a, b) => a.createdAt - b.createdAt);
                placeAll(listings);
                await table.bulkPut(listings);
            });

        // A brand-new database is seeded with every default from the registry
        // in settingsSchema.ts. Adding a *setting* later needs no new version:
        // a missing row reads as its default.
        this.on("populate", (tx) => tx.table("settings").bulkAdd(defaultRows()));
    }
}

export const db = new RentalIntelDatabase();

/** A fresh listing primary key: 64 random bits as hex. Opaque, nothing encoded. */
export function newListingId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
