import { sameSubject } from "../lib/match";
import { sourceById } from "../sources";
import type { Listing, RelationFields, SourceDetail } from "./types";

/**
 * How listings relate, decided when a listing is saved and stored on it
 * (`propertyId`, `buildingId`), so the panel reads links instead of
 * computing them over every pair on every render.
 *
 * Two relations:
 *   - the same place on another site: two listings of the same kind whose
 *     addresses agree, or that sit within a few tens of metres (lib/match.ts).
 *     They share a `propertyId`; the first one saved mints it.
 *   - a home that is a unit of a saved building, on the same site: the
 *     building lists the home's own id among its units (the building page
 *     said so), or the home names the building by its `sourceId` or by an
 *     id the building answers to (`answersTo`, from the source's
 *     `relations`; Zillow's lot ids). The home's `buildingId` is the
 *     building's listing id, set when either side is saved.
 *
 * Pure, except for the fresh id; the unit tests drive it with plain
 * objects, and listings.ts and db.ts call it inside their transactions.
 */

/** What the listing's source says relates it to others, from its detail. */
export function relationFields(source: string, detail: SourceDetail): RelationFields {
    return sourceById(source)?.relations?.(detail) ?? { answersTo: [], buildingRefs: [] };
}

/** Every id a listing answers to on its site. */
function keysOf(listing: Pick<Listing, "sourceId" | "answersTo">): string[] {
    return [listing.sourceId, ...listing.answersTo];
}

function unitIdsOf(listing: Pick<Listing, "core">): Set<string> {
    const ids = new Set<string>();
    for (const plan of listing.core.plans) for (const unit of plan.units) if (unit.id) ids.add(unit.id);
    return ids;
}

/** A listing as the placing needs it: everything but the two fields being decided, which may be known from an earlier save. */
export type Placeable = Pick<Listing, "id" | "source" | "sourceId" | "kind" | "core" | "answersTo" | "buildingRefs"> & Partial<Pick<Listing, "propertyId" | "buildingId">>;

/** Whether `home` is a unit of `building`: the building lists it, or it names the building. */
export function isUnitOf(home: Placeable, building: Placeable): boolean {
    if (home.source !== building.source || home.kind !== "home" || building.kind !== "building") return false;
    if (unitIdsOf(building).has(home.sourceId)) return true;
    const keys = keysOf(building);
    return home.buildingRefs.some((ref) => keys.includes(ref));
}

/** Whether two different listings of the same kind describe the same place. */
export function samePlace(a: Placeable, b: Placeable): boolean {
    return a.id !== b.id && a.kind === b.kind && sameSubject(a.core, b.core);
}

export interface Placement {
    propertyId: string;
    buildingId: string | null;
}

/** A fresh property id: 64 random bits as hex, like a listing's. */
function freshId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Where `listing` belongs among `others`: the property a twin already has,
 * else its own from an earlier save, else a new one; and, for a home, the
 * saved building it is a unit of. `others` may hold an older row of the
 * listing itself, which is never its own twin.
 */
export function place(listing: Placeable, others: readonly Listing[]): Placement {
    const twin = others.find((other) => other.propertyId && samePlace(listing, other));
    const propertyId = twin?.propertyId ?? listing.propertyId ?? freshId();
    const building = listing.kind === "home" ? (others.find((other) => isUnitOf(listing, other)) ?? null) : null;
    return { propertyId, buildingId: building?.id ?? null };
}

/** The homes among `others` that are units of `building` and not yet linked to it: a building adopts them when it is saved. */
export function unitsToAttach(building: Placeable, others: readonly Listing[]): Listing[] {
    return others.filter((other) => other.buildingId !== building.id && isUnitOf(other, building));
}

/**
 * Every listing's place, from scratch, in list order so twins share the
 * first one's id: the schema upgrade and an import. Mutates the rows.
 */
export function placeAll(listings: Listing[]): void {
    const placed: Listing[] = [];
    for (const listing of listings) {
        listing.propertyId = place({ ...listing, propertyId: undefined }, placed).propertyId;
        placed.push(listing);
    }
    for (const listing of listings) {
        listing.buildingId = listing.kind === "home" ? (listings.find((other) => isUnitOf(listing, other))?.id ?? null) : null;
    }
}
