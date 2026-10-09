import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, BACKUP_VERSION, backupFilename, parseBackup, serializeBackup, type Backup } from "./backupFormat";
import { emptyCore } from "./types";

const minimal = (): Backup => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
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
            readMethod: "test",
            partial: false,
            user: { status: "none", notes: "", links: [] },
            createdAt: 1,
            updatedAt: 1,
            capturedAt: 1,
        },
    ],
    listingPhotos: [{ listingId: "abc", photoHash: "h", order: 0 }],
    photos: [{ hash: "h", mimeType: "image/png", sourceUrl: "x", bytes: 3, createdAt: 1, data: "AQID" }],
});

describe("parseBackup", () => {
    it("round-trips a backup", () => {
        const backup = minimal();
        expect(parseBackup(serializeBackup(backup))).toEqual(backup);
    });

    it("tolerates a backup without the photo links", () => {
        const { listingPhotos: _l, ...rest } = minimal();
        expect(parseBackup(JSON.stringify(rest)).listingPhotos).toEqual([]);
    });

    it("upgrades a v1 file: the extra tables are dropped and each listing takes the current shape, `features` included", () => {
        const backup = minimal();
        const [listing] = backup.listings as unknown as Record<string, unknown>[];
        const { readMethod, ...old } = listing!;
        const { features: _features, ...oldCore } = old["core"] as Record<string, unknown>;
        const v1 = {
            ...backup,
            version: 1,
            schema: 2,
            listings: [{ ...old, core: oldCore, via: readMethod, propertyId: "p", buildingId: null, answersTo: [], buildingRefs: [], detail: { version: 1, data: { via: "dom", lotId: "5" } } }],
            captures: [{ listingId: "abc", capturedAt: 1, url: "x", payload: {} }],
            snapshots: [{ listingId: "abc", timestamp: 1 }],
        };
        const parsed = parseBackup(JSON.stringify(v1));
        expect(parsed.version).toBe(2);
        expect(parsed.listings).toEqual([{ ...backup.listings[0], detail: { version: 1, data: { lotId: "5" } } }]);
        expect("captures" in parsed).toBe(false);
    });

    it("refuses what is not a backup, with a readable reason", () => {
        expect(() => parseBackup("nope")).toThrow("Not a JSON file.");
        expect(() => parseBackup("[]")).toThrow("Not a backup file.");
        expect(() => parseBackup('{"format":"rentals-backup","version":1}')).toThrow("Not a Rental Intel backup.");
        expect(() => parseBackup(JSON.stringify({ ...minimal(), version: 99 }))).toThrow("Unsupported backup version: 99.");
        expect(() => parseBackup(JSON.stringify({ ...minimal(), listings: undefined }))).toThrow('Backup has no "listings" list.');
        expect(() => parseBackup(JSON.stringify({ ...minimal(), listings: [{ id: "x" }] }))).toThrow(/listing without/);
        expect(() => parseBackup(JSON.stringify({ ...minimal(), photos: [{ hash: "h" }] }))).toThrow(/photo without/);
    });

    it("names the file by date", () => {
        expect(backupFilename(new Date("2026-09-29T12:00:00Z"))).toBe("rental-intel-backup-2026-09-29.json");
    });
});
