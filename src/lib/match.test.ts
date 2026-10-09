import { describe, expect, it } from "vitest";
import { addressKey, distanceMetres, normalizeStreet, normalizeUnit, sameSubject } from "./match";
import type { Address } from "../db/types";

const address = (parts: Partial<Address>): Address => ({ line1: null, unit: null, city: null, state: null, zip: null, text: null, ...parts });

describe("normalizeStreet", () => {
    it("abbreviates street words and drops punctuation", () => {
        expect(normalizeStreet("118 Pecan Street N.")).toBe("118 pecan st n");
        expect(normalizeStreet("100 North Main Street")).toBe("100 n main st");
        expect(normalizeStreet("  ")).toBeNull();
    });
});

describe("normalizeUnit", () => {
    it("keeps the designation only", () => {
        expect(normalizeUnit("Unit B")).toBe("b");
        expect(normalizeUnit("#204")).toBe("204");
        expect(normalizeUnit("Apt. 3")).toBe("3");
        expect(normalizeUnit(null)).toBeNull();
    });
});

describe("addressKey", () => {
    it("uses the street line and the zip", () => {
        expect(addressKey(address({ line1: "118 Pecan St N", zip: "62704" }))).toBe("118 pecan st n|62704");
    });
    it("falls back to the first line of the text and the city", () => {
        expect(addressKey(address({ text: "118 Pecan Street N, Springfield, IL 62704", city: "Springfield" }))).toBe("118 pecan st n|springfield");
    });
    it("is null without a street line", () => {
        expect(addressKey(address({ city: "Springfield" }))).toBeNull();
    });
});

describe("sameSubject", () => {
    const a = { address: address({ line1: "118 Pecan St N", unit: "B", zip: "62704" }), geo: { lat: 39.78, lng: -89.65 } };

    it("matches the same street address written differently", () => {
        const b = { address: address({ text: "118 Pecan Street North, Springfield, IL 62704", zip: "62704" }), geo: null };
        expect(sameSubject(a, b)).toBe(true);
    });

    it("refuses a different unit at the same address", () => {
        const b = { address: address({ line1: "118 Pecan St N", unit: "Unit C", zip: "62704" }), geo: a.geo };
        expect(sameSubject(a, b)).toBe(false);
    });

    it("falls back to coordinates when one side has no street line", () => {
        const near = { address: address({ text: "The Juniper" }), geo: { lat: 39.78005, lng: -89.65005 } };
        const far = { address: address({ text: "The Juniper" }), geo: { lat: 39.79, lng: -89.65 } };
        expect(sameSubject(a, near)).toBe(true);
        expect(sameSubject(a, far)).toBe(false);
    });

    it("does not guess with nothing to go on", () => {
        expect(sameSubject({ address: address({}), geo: null }, { address: address({}), geo: null })).toBe(false);
    });
});

describe("distanceMetres", () => {
    it("is about 111 km per degree of latitude", () => {
        expect(distanceMetres({ lat: 47, lng: -122 }, { lat: 48, lng: -122 })).toBeCloseTo(111_195, -3);
    });
});
