import Dexie, { type EntityTable } from "dexie";
import { defaultRows, type SettingRow } from "./settingsSchema";
import { upgradeListingRecord, type Listing, type ListingPhoto, type Photo } from "./types";

/**
 * The database lives in the extension origin: the service worker and the side
 * panel open the same IndexedDB; content scripts never touch it. Bump
 * `version(n)` and add an upgrade step when a store changes.
 */
class RentalIntelDatabase extends Dexie {
    declare listings: EntityTable<Listing, "id">;
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

        this.version(2).stores({
            listings: "id, [source+sourceId], source, kind, updatedAt, capturedAt, user.status, propertyId, buildingId, *answersTo, *buildingRefs",
        });

        // v3: raw captures, snapshots and stored relations go; `via` becomes `readMethod`.
        this.version(3)
            .stores({
                captures: null,
                snapshots: null,
                listings: "id, [source+sourceId], source, kind, updatedAt, capturedAt, user.status",
            })
            .upgrade((tx) =>
                tx
                    .table("listings")
                    .toCollection()
                    .modify((row: Record<string, unknown>) => {
                        upgradeListingRecord(row);
                    }),
            );

        // v4: `core.features` on every listing, empty until re-captured.
        this.version(4)
            .stores({})
            .upgrade((tx) =>
                tx
                    .table("listings")
                    .toCollection()
                    .modify((row: Record<string, unknown>) => {
                        upgradeListingRecord(row);
                    }),
            );

        // A new database is seeded with every default; a missing row later reads as its default.
        this.on("populate", (tx) => tx.table("settings").bulkAdd(defaultRows()));
    }
}

export const db = new RentalIntelDatabase();

/** A fresh listing primary key: 64 random bits as hex. */
export function newListingId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
