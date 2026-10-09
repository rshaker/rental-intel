import { record } from "../sources/shared/values";
import { upgradeListingRecord, type Listing, type ListingPhoto, type Photo } from "./types";

/**
 * The backup file: the listings, their photo links and the photo bytes as
 * base64, as JSON. Dexie-free so the format can be unit-tested; backup.ts
 * reads and writes the database.
 */

export const BACKUP_FORMAT = "rental-intel-backup";
/** v1 files also carried `captures`, `snapshots` and stored relations; they still import. A v2 file from before `core.features` imports with it empty. */
export const BACKUP_VERSION = 2;

/** A photo row with its bytes as base64 in place of the blob. */
export type PhotoRecord = Omit<Photo, "blob"> & { data: string };

export interface Backup {
    format: typeof BACKUP_FORMAT;
    version: typeof BACKUP_VERSION;
    exportedAt: number;
    listings: Listing[];
    listingPhotos: ListingPhoto[];
    photos: PhotoRecord[];
}

export function serializeBackup(backup: Backup): string {
    return JSON.stringify(backup);
}

export function backupFilename(when: Date): string {
    return `rental-intel-backup-${when.toISOString().slice(0, 10)}.json`;
}

/** Parses and sanity-checks a backup file; throws a readable Error on anything that is not one. */
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

type Row = Record<string, unknown>;

const isString = (value: unknown): value is string => typeof value === "string";

/** The rows of one list, each checked by `valid`; a missing optional list is empty. */
function rowsOf(root: Row, list: string, required: boolean, valid: (row: Row) => boolean, problem: string): Row[] {
    const value = root[list];
    if (value === undefined && !required) return [];
    if (!Array.isArray(value)) throw new Error(`Backup has no "${list}" list.`);
    return value.map((item) => {
        const row = record(item);
        if (!row) throw new Error(`Backup "${list}" contains something that is not a row.`);
        if (!valid(row)) throw new Error(problem);
        return row;
    });
}

export function backupFromValue(value: Row): Backup {
    if (value["format"] !== BACKUP_FORMAT) throw new Error("Not a Rental Intel backup.");
    const version = value["version"];
    if (version !== 1 && version !== 2) throw new Error(`Unsupported backup version: ${String(version)}.`);

    const listings = rowsOf(value, "listings", true, (row) => isString(row["id"]) && isString(row["source"]) && isString(row["sourceId"]) && record(row["core"]) !== null && record(row["user"]) !== null, "Backup contains a listing without an id, source, core or user fields.");
    const listingPhotos = rowsOf(value, "listingPhotos", false, (row) => isString(row["listingId"]) && isString(row["photoHash"]), "Backup contains a photo link without its two ends.");
    const photos = rowsOf(value, "photos", true, (row) => isString(row["hash"]) && isString(row["data"]), "Backup contains a photo without a hash or its bytes.");

    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: typeof value["exportedAt"] === "number" ? value["exportedAt"] : 0,
        listings: listings.map(upgradeListingRecord) as unknown as Listing[],
        listingPhotos: listingPhotos as unknown as ListingPhoto[],
        photos: photos as unknown as PhotoRecord[],
    };
}
