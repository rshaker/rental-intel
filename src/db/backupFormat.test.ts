import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_VERSION, backupFilename, parseBackup, serializeBackup, type Backup } from "./backupFormat";
import { emptyCore } from "./types";

const minimal = (): Backup => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schema: 1,
    exportedAt: 1,
    listings: [
        {
            id: "abc",
            source: "example",
            sourceId: "juniper01",
            url: "https://listings.example/l/juniper01/",
            kind: "building",
            core: emptyCore(),
            detail: { version: 1, data: null },
            via: "test",
            partial: false,
            propertyId: "abc",
            buildingId: null,
            answersTo: [],
            buildingRefs: [],
            user: { status: "none", notes: "", links: [] },
            createdAt: 1,
            updatedAt: 1,
            capturedAt: 1,
        },
    ],
    captures: [{ listingId: "abc", capturedAt: 1, url: "https://listings.example/l/juniper01/", payload: { a: 1 } }],
    snapshots: [{ listingId: "abc", timestamp: 1, rentMin: 1, rentMax: 2, availableUnits: 1, status: "none" }],
    listingPhotos: [{ listingId: "abc", photoHash: "h", order: 0 }],
    photos: [{ hash: "h", mimeType: "image/png", sourceUrl: "x", bytes: 3, createdAt: 1, data: "AQID" }],
});

describe("parseBackup", () => {
    it("round-trips a backup", () => {
        const backup = minimal();
        expect(parseBackup(serializeBackup(backup))).toEqual(backup);
    });

    it("tolerates a backup without the optional lists", () => {
        const { captures: _c, snapshots: _s, listingPhotos: _l, ...rest } = minimal();
        const parsed = parseBackup(JSON.stringify(rest));
        expect(parsed.captures).toEqual([]);
        expect(parsed.snapshots).toEqual([]);
        expect(parsed.listingPhotos).toEqual([]);
    });

    it("refuses what is not a backup, with a readable reason", () => {
        expect(() => parseBackup("nope")).toThrow("Not a JSON file.");
        expect(() => parseBackup("[]")).toThrow("Not a backup file.");
        expect(() => parseBackup('{"format":"rentals-backup","version":1}')).toThrow("Not a Rental Intel backup.");
        expect(() => parseBackup(JSON.stringify({ ...minimal(), version: 99 }))).toThrow("Unsupported backup version: 99.");
        expect(() => parseBackup(JSON.stringify({ ...minimal(), listings: [{ id: "x" }] }))).toThrow(/listing without/);
        expect(() => parseBackup(JSON.stringify({ ...minimal(), photos: [{ hash: "h" }] }))).toThrow(/photo without/);
    });

    it("names the file by date", () => {
        expect(backupFilename(new Date("2026-09-29T12:00:00Z"))).toBe("rental-intel-backup-2026-09-29.json");
    });
});
