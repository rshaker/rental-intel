import { describe, expect, it } from "vitest";
import { normalizeLink } from "./links";

describe("normalizeLink", () => {
    it("accepts web addresses, with or without a scheme", () => {
        expect(normalizeLink("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
        expect(normalizeLink("example.com/path")).toBe("https://example.com/path");
        expect(normalizeLink("  http://localhost:3000/  ")).toBe("http://localhost:3000/");
    });

    it("refuses anything that is not one", () => {
        expect(normalizeLink("")).toBeNull();
        expect(normalizeLink("not a url")).toBeNull();
        expect(normalizeLink("javascript:alert(1)")).toBeNull();
        expect(normalizeLink("mailto:someone@example.com")).toBeNull();
        expect(normalizeLink("justaword")).toBeNull();
    });
});
