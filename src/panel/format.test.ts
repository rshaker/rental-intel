import { describe, expect, it } from "vitest";
import { availabilityText, bytesText, unitFacts, unitStatusText } from "./format";

/** The wording of a unit's line, in particular for a unit not on the rental market. */

describe("unitFacts", () => {
    const unit = { rent: 1650, beds: 1, baths: 1, sqft: 525, availableFrom: "now" as string | null, status: null as "for-rent" | "for-sale" | "off-market" | null };

    it("lists rent, rooms, size and availability", () => {
        expect(unitFacts(unit)).toBe("$1,650 · 1bd/1ba · 525 sqft · available now");
        expect(unitFacts({ ...unit, status: "for-rent" })).toBe("$1,650 · 1bd/1ba · 525 sqft · available now");
    });

    it("says why a unit has no availability instead of inventing one", () => {
        expect(unitFacts({ ...unit, rent: null, availableFrom: null, status: "off-market" })).toBe("1bd/1ba · 525 sqft · off market");
        expect(unitFacts({ ...unit, rent: null, availableFrom: null, status: "for-sale" })).toBe("1bd/1ba · 525 sqft · for sale");
        // The status wins even when a stale availability survived.
        expect(unitFacts({ ...unit, availableFrom: "now", status: "off-market" })).toBe("$1,650 · 1bd/1ba · 525 sqft · off market");
    });

    it("has words only for the statuses that need explaining", () => {
        expect(unitStatusText("for-rent")).toBe("");
        expect(unitStatusText(null)).toBe("");
        expect(availabilityText(null)).toBe("");
    });
});

describe("bytesText", () => {
    it("reads like a file dialog", () => {
        expect(bytesText(96)).toBe("96 bytes");
        expect(bytesText(412_300)).toBe("412 kB");
        expect(bytesText(13_049_000)).toBe("13.0 MB");
    });
});
