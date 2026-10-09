import { db } from "./db";
import { BACKUP_FORMAT, BACKUP_VERSION, type Backup, type PhotoRecord } from "./backupFormat";
import type { Photo } from "./types";

/** Backup and restore of the whole database. The file format is backupFormat.ts. */

export async function exportBackup(): Promise<Backup> {
    // Rows inside one transaction so the tables agree; blob reads after it, since awaiting anything that is not an IndexedDB request would commit a Dexie transaction early.
    const [listings, listingPhotos, photoRows] = await db.transaction("r", db.listings, db.listingPhotos, db.photos, () => Promise.all([db.listings.toArray(), db.listingPhotos.toArray(), db.photos.toArray()]));
    const photos: PhotoRecord[] = [];
    for (const { blob, ...rest } of photoRows) {
        photos.push({ ...rest, data: new Uint8Array(await blob.arrayBuffer()).toBase64() });
    }
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: Date.now(), listings, listingPhotos, photos };
}

export interface ImportResult {
    listings: number;
    photos: number;
}

/** Merges a backup in: a listing in the file replaces the one with the same id, links and all, so importing twice equals importing once. Links and photos nothing in the file refers to are dropped. */
export async function importBackup(backup: Backup): Promise<ImportResult> {
    const ids = new Set(backup.listings.map((listing) => listing.id));
    // Auto-increment ids are the old database's; this one hands out its own.
    const links = backup.listingPhotos.filter((l) => ids.has(l.listingId)).map(({ id: _id, ...rest }) => rest);
    const wanted = new Set(links.map((link) => link.photoHash));
    const photos: Photo[] = backup.photos.filter((photo) => wanted.has(photo.hash)).map(({ data, ...rest }) => ({ ...rest, blob: new Blob([Uint8Array.fromBase64(data)], { type: rest.mimeType }) }));

    await db.transaction("rw", db.listings, db.listingPhotos, db.photos, async () => {
        await db.listingPhotos.where("listingId").anyOf([...ids]).delete();
        await db.listings.bulkPut(backup.listings);
        await db.listingPhotos.bulkAdd(links);
        await db.photos.bulkPut(photos);
    });

    return { listings: backup.listings.length, photos: photos.length };
}

/** Empties every table but settings. No undo; the panel asks first. */
export async function clearAll(): Promise<void> {
    await db.transaction("rw", db.listings, db.listingPhotos, db.photos, () => Promise.all([db.listings.clear(), db.listingPhotos.clear(), db.photos.clear()]));
}
