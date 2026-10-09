import { db } from "./db";
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup, type PhotoRecord } from "./backupFormat";
import { placeAll, relationFields } from "./relations";
import type { Photo } from "./types";

/** Backup and restore of the whole database. The file format lives in backupFormat.ts. */

export async function exportBackup(): Promise<Backup> {
    // Rows first, inside one transaction so the tables agree with each other;
    // blob reads after it, because awaiting anything that is not an IndexedDB
    // request would let a Dexie transaction commit under us.
    const [listings, captures, snapshots, listingPhotos, photoRows] = await db.transaction(
        "r",
        db.listings,
        db.captures,
        db.snapshots,
        db.listingPhotos,
        db.photos,
        () =>
            Promise.all([
                db.listings.toArray(),
                db.captures.toArray(),
                db.snapshots.toArray(),
                db.listingPhotos.toArray(),
                db.photos.toArray(),
            ]),
    );

    const photos: PhotoRecord[] = [];
    for (const { blob, ...rest } of photoRows) {
        photos.push({ ...rest, data: new Uint8Array(await blob.arrayBuffer()).toBase64() });
    }

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        schema: db.verno,
        exportedAt: Date.now(),
        listings,
        captures,
        snapshots,
        listingPhotos,
        photos,
    };
}

export interface ImportResult {
    listings: number;
    photos: number;
}

/**
 * Merges a backup into the database. A listing in the file replaces the
 * listing with the same id wholesale -- row, raw capture, history, photo
 * links -- so importing twice is the same as importing once, and importing
 * onto a live database is safe. Photos dedupe by content hash as they always do.
 *
 * Rows in the file that point at a listing the file does not contain are
 * dropped rather than left dangling; so are photos nothing in the file links.
 * Every listing is placed again afterwards (db/relations.ts): the file may
 * predate the stored relations, and its listings may be twins of ones
 * already here.
 */
export async function importBackup(backup: Backup): Promise<ImportResult> {
    const ids = new Set(backup.listings.map((listing) => listing.id));
    // Auto-increment ids are the old database's; the new one hands out its own.
    const links = backup.listingPhotos.filter((l) => ids.has(l.listingId)).map(({ id: _id, ...rest }) => rest);
    const snapshots = backup.snapshots.filter((s) => ids.has(s.listingId)).map(({ id: _id, ...rest }) => rest);
    const captures = backup.captures.filter((c) => ids.has(c.listingId));
    const wanted = new Set(links.map((link) => link.photoHash));
    const photos: Photo[] = backup.photos
        .filter((photo) => wanted.has(photo.hash))
        .map(({ data, ...rest }) => ({ ...rest, blob: new Blob([Uint8Array.fromBase64(data)], { type: rest.mimeType }) }));

    await db.transaction("rw", db.listings, db.captures, db.snapshots, db.listingPhotos, db.photos, async () => {
        const idList = [...ids];
        await db.snapshots.where("listingId").anyOf(idList).delete();
        await db.listingPhotos.where("listingId").anyOf(idList).delete();
        await db.captures.bulkDelete(idList);
        await db.listings.bulkPut(backup.listings);
        await db.captures.bulkPut(captures);
        await db.snapshots.bulkAdd(snapshots);
        await db.listingPhotos.bulkAdd(links);
        await db.photos.bulkPut(photos);

        const all = (await db.listings.toArray()).map((listing) => ({ ...listing, ...relationFields(listing.source, listing.detail) })).sort((a, b) => a.createdAt - b.createdAt);
        placeAll(all);
        await db.listings.bulkPut(all);
    });

    return { listings: backup.listings.length, photos: photos.length };
}

/** Empties every table but settings. There is no undo; the panel asks first. */
export async function clearAll(): Promise<void> {
    await db.transaction("rw", db.listings, db.captures, db.snapshots, db.listingPhotos, db.photos, () =>
        Promise.all([db.listings.clear(), db.captures.clear(), db.snapshots.clear(), db.listingPhotos.clear(), db.photos.clear()]),
    );
}
