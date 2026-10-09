import { db, newListingId } from "./db";
import { getSetting } from "./settings";
import { type Capture, type CoreFields, type Listing, type ListingKind, type ListingRef, type UserFields } from "./types";

/** The listing a site's id names, if it has been saved. */
export function findByRef(ref: ListingRef): Promise<Listing | undefined> {
    return db.listings.where("[source+sourceId]").equals([ref.source, ref.sourceId]).first();
}

/** Creates a listing, or refreshes the captured half of an existing one. User fields are carried across untouched. */
export async function upsertCapture(capture: Capture): Promise<Listing> {
    const now = Date.now();
    const fresh: UserFields = { status: await getSetting("listings.defaultStatus"), notes: "", links: [] };
    const existing = await findByRef(capture);
    const listing: Listing = {
        id: existing?.id ?? newListingId(),
        source: capture.source,
        sourceId: capture.sourceId,
        url: capture.url,
        kind: capture.kind,
        core: capture.core,
        detail: capture.detail,
        readMethod: capture.readMethod,
        partial: capture.partial,
        user: existing?.user ?? fresh,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        capturedAt: now,
    };
    await db.listings.put(listing);
    return listing;
}

export function getListing(id: string): Promise<Listing | undefined> {
    return db.listings.get(id);
}

/** Most recently touched first. */
export function listListings(kind?: ListingKind): Promise<Listing[]> {
    const ordered = db.listings.orderBy("updatedAt").reverse();
    return (kind ? ordered.filter((listing) => listing.kind === kind) : ordered).toArray();
}

/** Writes user-authored fields only; bumps `updatedAt`, leaves `capturedAt` alone. */
export async function updateUserFields(id: string, patch: Partial<UserFields>): Promise<void> {
    await db.transaction("rw", db.listings, async () => {
        const existing = await db.listings.get(id);
        if (!existing) throw new Error(`No listing ${id}`);
        await db.listings.update(id, { user: { ...existing.user, ...patch }, updatedAt: Date.now() });
    });
}

/** Removes listings and their photo links; a photo blob is dropped once nothing links it. */
export async function deleteListings(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.transaction("rw", db.listings, db.listingPhotos, db.photos, async () => {
        const links = await db.listingPhotos.where("listingId").anyOf(ids).toArray();
        const candidates = [...new Set(links.map((link) => link.photoHash))];
        await db.listingPhotos.where("listingId").anyOf(ids).delete();
        await db.listings.bulkDelete(ids);
        const stillUsed = new Set((await db.listingPhotos.where("photoHash").anyOf(candidates).uniqueKeys()) as string[]);
        await db.photos.bulkDelete(candidates.filter((hash) => !stillUsed.has(hash)));
    });
}

function sameRange(a: { min: number | null; max: number | null }, b: { min: number | null; max: number | null }): boolean {
    return a.min === b.min && a.max === b.max;
}

/** Whether a fresh capture says anything new, judged on `core` alone. Drives "update" vs "saved" on the capture button, and whether a re-capture is written. */
export function hasChanged(existing: Pick<Listing, "kind" | "core">, capture: Pick<Capture, "kind" | "core">): boolean {
    const a: CoreFields = existing.core;
    const b: CoreFields = capture.core;
    if (existing.kind !== capture.kind) return true;
    return (
        a.name !== b.name ||
        a.address.text !== b.address.text ||
        !sameRange(a.rent, b.rent) ||
        !sameRange(a.beds, b.beds) ||
        !sameRange(a.baths, b.baths) ||
        !sameRange(a.sqft, b.sqft) ||
        a.availableUnits !== b.availableUnits ||
        a.plans.length !== b.plans.length ||
        a.plans.reduce((n, p) => n + p.units.length, 0) !== b.plans.reduce((n, p) => n + p.units.length, 0) ||
        a.photoUrls.length !== b.photoUrls.length ||
        a.features.join() !== b.features.join()
    );
}
