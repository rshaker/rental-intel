import * as z from "zod/mini";
import { record } from "../sources/shared/values";
import type { Listing, ListingPhoto, Photo, RawCapture, Snapshot } from "./types";

/**
 * The backup file: every table, as JSON. Pure -- no Dexie -- so the encoding
 * and the validation can be unit-tested; the reading and writing of the
 * database is in backup.ts.
 *
 * Photo bytes travel as base64, since JSON has no binary. That makes a backup
 * sizeable (a listing carries 8-30 photos) but self-contained: the CDN URLs in
 * `photoUrls` rot once a listing is pulled, so a backup without the bytes
 * would restore listings with empty carousels.
 */

export const BACKUP_FORMAT = "rental-intel-backup";
export const BACKUP_VERSION = 1;

/** A photo row with its bytes as base64 in place of the blob. */
export type PhotoRecord = Omit<Photo, "blob"> & { data: string };

export interface Backup {
    format: typeof BACKUP_FORMAT;
    version: typeof BACKUP_VERSION;
    /** The Dexie schema version the rows came from, for an import to upgrade against one day. */
    schema: number;
    exportedAt: number;
    listings: Listing[];
    captures: RawCapture[];
    snapshots: Snapshot[];
    listingPhotos: ListingPhoto[];
    photos: PhotoRecord[];
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeBackup(backup: Backup): string {
    return JSON.stringify(backup);
}

export function backupFilename(when: Date): string {
    return `rental-intel-backup-${when.toISOString().slice(0, 10)}.json`;
}

/**
 * The checks are structural -- the identity of each row and the shape of
 * each list -- not a full schema validation; a backup is our own output, not
 * hostile input. The rows keep whatever else they carry.
 */
const row = z.record(z.string(), z.unknown());
const BackupSchema = z.object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    schema: z.catch(z.number(), 0),
    exportedAt: z.catch(z.number(), 0),
    listings: z.array(z.looseObject({ id: z.string(), source: z.string(), sourceId: z.string(), core: row, user: row })),
    captures: z._default(z.array(z.looseObject({ listingId: z.string() })), []),
    snapshots: z._default(z.array(row), []),
    listingPhotos: z._default(z.array(z.looseObject({ listingId: z.string(), photoHash: z.string() })), []),
    photos: z.array(z.looseObject({ hash: z.string(), data: z.string() })),
});

/** What is wrong with a row of each list, said once per list. */
const ROW_ERRORS: Record<string, string> = {
    listings: "Backup contains a listing without an id, source, core or user fields.",
    photos: "Backup contains a photo without a hash or its bytes.",
    captures: "Backup contains a capture without its listing.",
    listingPhotos: "Backup contains a photo link without its two ends.",
};

/** The first thing wrong with a backup, as one readable sentence. */
function describeIssue(value: Record<string, unknown>, issue: z.core.$ZodIssue): string {
    const [list, index] = issue.path;
    if (list === "format") return "Not a Rental Intel backup.";
    if (list === "version") return `Unsupported backup version: ${String(value["version"])}.`;
    if (typeof list !== "string") return "Not a backup file.";
    if (index === undefined) return `Backup has no "${list}" list.`;
    return ROW_ERRORS[list] ?? `Backup "${list}" contains something that is not a row.`;
}

/**
 * Parses and sanity-checks a backup file. Throws a readable Error rather than
 * letting bad input reach the database. The file format tag decides what
 * this is.
 */
export function parseBackup(text: string): Backup {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error("Not a JSON file.");
    }
    const root = record(value);
    if (!root) throw new Error("Not a backup file.");
    return backupFromValue(root);
}

export function backupFromValue(value: Record<string, unknown>): Backup {
    const parsed = BackupSchema.safeParse(value);
    if (!parsed.success) throw new Error(describeIssue(value, parsed.error.issues[0]!));
    const { listings, captures, snapshots, listingPhotos, photos, ...rest } = parsed.data;
    return {
        ...rest,
        listings: listings as unknown as Listing[],
        captures: captures as unknown as RawCapture[],
        snapshots: snapshots as unknown as Snapshot[],
        listingPhotos: listingPhotos as unknown as ListingPhoto[],
        photos: photos as unknown as PhotoRecord[],
    };
}
