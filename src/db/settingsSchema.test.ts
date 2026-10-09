import { describe, expect, it } from "vitest";
import { SECTIONS, SETTINGS, SETTING_KEYS, defaultRows, defaultSettings, isValidValue, keysInSection, settingsFrom } from "./settingsSchema";

describe("the settings registry", () => {
    it("names every setting after its section", () => {
        for (const key of SETTING_KEYS) {
            const section = key.slice(0, key.indexOf("."));
            expect(SECTIONS[section], `${key} has no section`).toBeDefined();
        }
    });

    it("has a default that fits its own bounds", () => {
        for (const key of SETTING_KEYS) expect(isValidValue(key, SETTINGS[key]!.default), key).toBe(true);
    });

    it("seeds the table with every default", () => {
        const rows = defaultRows();
        expect(rows.map((row) => row.key)).toEqual(SETTING_KEYS);
        expect(settingsFrom(rows)).toEqual(defaultSettings());
    });

    it("lists a section's keys in registry order", () => {
        expect(keysInSection("bulk")).toEqual(["bulk.detectTimeout", "bulk.pace", "bulk.maxConsecutiveFailures"]);
    });
});

describe("settingsFrom", () => {
    it("takes stored values that fit and ignores the rest", () => {
        const settings = settingsFrom([
            { key: "bulk.pace", value: 5 },
            { key: "bulk.pace", value: 999 }, // out of range: ignored, the earlier good value stands
            { key: "photos.save", value: "yes" }, // wrong type
            { key: "gone.setting", value: 1 }, // removed
            { key: "listings.defaultStatus", value: "interested" },
        ]);
        expect(settings["bulk.pace"]).toBe(5);
        expect(settings["photos.save"]).toBe(true);
        expect(settings["listings.defaultStatus"]).toBe("interested");
        expect("gone.setting" in settings).toBe(false);
    });
});
