import { describe, expect, it } from "vitest";
import { availability, idString, num, rangeText, str, strings } from "./values";

describe("num", () => {
    it("reads numbers out of site strings", () => {
        expect(num(1895)).toBe(1895);
        expect(num("$1,895")).toBe(1895);
        expect(num("1,150 sq ft")).toBe(1150);
        expect(num("2.5")).toBe(2.5);
        expect(num("Call for rent")).toBeNull();
        expect(num(null)).toBeNull();
        expect(num(Number.NaN)).toBeNull();
    });
});

describe("str, idString, strings", () => {
    it("trims and refuses empties", () => {
        expect(str("  x ")).toBe("x");
        expect(str("   ")).toBeNull();
        expect(idString(12345)).toBe("12345");
        expect(idString("abc")).toBe("abc");
        expect(strings(["a", { url: "b" }, 3, null], "url")).toEqual(["a", "b"]);
    });
});

describe("rangeText", () => {
    it("reads ranges the way sites write them", () => {
        expect(rangeText("$1,200 - $1,800")).toEqual({ min: 1200, max: 1800 });
        expect(rangeText("$1,200+")).toEqual({ min: 1200, max: null });
        expect(rangeText("$1,200")).toEqual({ min: 1200, max: 1200 });
        expect(rangeText("Call for rent")).toEqual({ min: null, max: null });
    });
});

describe("availability", () => {
    it("normalises to now or an ISO date, else keeps the words", () => {
        expect(availability("Available Now")).toBe("now");
        expect(availability("2026-11-01")).toBe("2026-11-01");
        expect(availability("10/15/2026")).toBe("2026-10-15");
        expect(availability("Available Oct 1, 2026")).toBe("2026-10-01");
        expect(availability("Soon")).toBe("Soon");
        expect(availability("")).toBeNull();
    });
});
