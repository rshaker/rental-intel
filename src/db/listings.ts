import { db, newListingId } from "./db";
import { place, relationFields, unitsToAttach } from "./relations";
import { getSetting } from "./settings";
import { type Capture, type CoreFields, type Listing, type ListingKind, type ListingRef, type UserFields } from "./types";

/** The listing a site's id names, if it has been saved. */
export function findByRef(ref: ListingRef): Promise<Listing | undefined> {
    return db.listings.where("[source+sourceId]").equals([ref.source, ref.sourceId]).first();
}

/**
 * Creates a listing, or refreshes the captured half of an existing one. User
 * fields are carried across untouched -- re-capturing a listing must never
 * clear notes or reset status. The listing is placed among the others
 * (db/relations.ts): it joins the property of a twin on another site and,
 * as a home, the building it is a unit of; as a building, it adopts the
 * homes already saved from its units. The raw payload goes to its own table
 * and the numbers a price history needs go to a snapshot, all in the same
 * transaction.
 */
export async function upsertCapture(capture: Capture): Promise<Listing> {
    const now = Date.now();
    // Read before the transaction: it is not among the tables the transaction
    // names, and Dexie refuses reads of tables outside the current one.
    const fresh: UserFields = { status: await getSetting("listings.defaultStatus"), notes: "", links: [] };
    const fields = relationFields(capture.source, capture.detail);

    return db.transaction("rw", db.listings, db.captures, db.snapshots, async () => {
        const existing = await findByRef(capture);
        const others = await db.listings.toArray();
        const draft = { id: existing?.id ?? newListingId(), source: capture.source, sourceId: capture.sourceId, kind: capture.kind, core: capture.core, ...fields, propertyId: existing?.propertyId };
        const listing: Listing = {
            ...draft,
            ...place(draft, others),
            url: capture.url,
            detail: capture.detail,
            via: capture.via,
            partial: capture.partial,
            user: existing?.user ?? fresh,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            capturedAt: now,
        };

        await db.listings.put(listing);
        if (listing.kind === "building") {
            const units = unitsToAttach(listing, others);
            if (units.length) await db.listings.bulkPut(units.map((unit) => ({ ...unit, buildingId: listing.id })));
        }
        await db.captures.put({ listingId: listing.id, capturedAt: now, url: capture.url, payload: capture.raw });
        await db.snapshots.add({
            listingId: listing.id,
            timestamp: now,
            rentMin: capture.core.rent.min,
            rentMax: capture.core.rent.max,
            availableUnits: capture.core.availableUnits,
            status: listing.user.status,
        });

        return listing;
    });
}

export function getListing(id: string): Promise<Listing | undefined> {
    return db.listings.get(id);
}

/** Most recently touched first -- the order the side panel list wants. */
export function listListings(kind?: ListingKind): Promise<Listing[]> {
    const ordered = db.listings.orderBy("updatedAt").reverse();
    return (kind ? ordered.filter((listing) => listing.kind === kind) : ordered).toArray();
}

/** Writes user-authored fields only. Bumps `updatedAt`, leaves `capturedAt` alone. */
export async function updateUserFields(id: string, patch: Partial<UserFields>): Promise<void> {
    await db.transaction("rw", db.listings, async () => {
        const existing = await db.listings.get(id);
        if (!existing) throw new Error(`No listing ${id}`);
        await db.listings.update(id, {
            user: { ...existing.user, ...patch },
            updatedAt: Date.now(),
        });
    });
}

/**
 * Removes listings and everything hanging off them. Photos are content-hash
 * deduped and may be shared between listings, so only the blobs that nothing
 * still references are dropped -- decided after the links are gone, inside the
 * same transaction, so a concurrent capture cannot re-link a hash we then delete.
 */
export async function deleteListings(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    await db.transaction("rw", db.listings, db.captures, db.listingPhotos, db.snapshots, db.photos, async () => {
        const links = await db.listingPhotos.where("listingId").anyOf(ids).toArray();
        const candidates = [...new Set(links.map((link) => link.photoHash))];

        await db.listingPhotos.where("listingId").anyOf(ids).delete();
        await db.snapshots.where("listingId").anyOf(ids).delete();
        await db.captures.bulkDelete(ids);
        await db.listings.bulkDelete(ids);

        // uniqueKeys() over the photoHash index yields the hashes themselves,
        // without materialising the rows.
        const stillUsed = new Set((await db.listingPhotos.where("photoHash").anyOf(candidates).uniqueKeys()) as string[]);
        await db.photos.bulkDelete(candidates.filter((hash) => !stillUsed.has(hash)));
    });
}

function sameRange(a: { min: number | null; max: number | null }, b: { min: number | null; max: number | null }): boolean {
    return a.min === b.min && a.max === b.max;
}

/**
 * Whether a fresh capture says anything new, judged on `core` alone: the
 * raw payload churns on every page load and `detail` is the site's business.
 * Drives the "update" vs "saved" capture-button states.
 */
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
        a.photoUrls.length !== b.photoUrls.length
    );
}
