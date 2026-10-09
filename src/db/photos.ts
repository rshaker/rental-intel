import Dexie from "dexie";
import { db } from "./db";
import type { Photo } from "./types";
import { hashBlob } from "../lib/hash";

/** Re-exported so the photo surface stays one import for callers that use both. */
export { hashBlob };

/**
 * Stores a photo blob if its content hash is new, and returns the hash either
 * way. Deduping here is what keeps re-captures from doubling storage.
 */
export async function putPhoto(blob: Blob, sourceUrl: string): Promise<string> {
    const hash = await hashBlob(blob);
    const existing = await db.photos.get(hash);
    if (!existing) {
        await db.photos.put({
            hash,
            blob,
            mimeType: blob.type || "image/jpeg",
            sourceUrl,
            bytes: blob.size,
            createdAt: Date.now(),
        });
    }
    return hash;
}

/** Replaces a listing's photo list, preserving the given order. */
export async function linkPhotos(listingId: string, hashes: string[]): Promise<void> {
    await db.transaction("rw", db.listingPhotos, async () => {
        await db.listingPhotos.where("listingId").equals(listingId).delete();
        await db.listingPhotos.bulkAdd(hashes.map((photoHash, order) => ({ listingId, photoHash, order })));
    });
}

export async function getPhotos(listingId: string): Promise<Photo[]> {
    const links = await db.listingPhotos
        .where("[listingId+order]")
        .between([listingId, Dexie.minKey], [listingId, Dexie.maxKey])
        .toArray();
    const photos = await db.photos.bulkGet(links.map((l) => l.photoHash));
    return photos.filter((p): p is Photo => p !== undefined);
}
