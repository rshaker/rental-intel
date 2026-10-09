import { describe, expect, it } from "vitest";
import { matchesAny, matchesPattern, patternToRegExp } from "./matchPattern";

describe("matchesPattern", () => {
    it("matches a wildcard subdomain pattern the way Chrome does", () => {
        const pattern = "*://*.apartments.com/*";
        expect(matchesPattern(pattern, "https://www.apartments.com/austin-tx/")).toBe(true);
        expect(matchesPattern(pattern, "http://apartments.com/")).toBe(true);
        expect(matchesPattern(pattern, "https://images1.apartments.com/i2/x/y.jpg?p=1")).toBe(true);
        expect(matchesPattern(pattern, "https://apartments.com.evil.example/")).toBe(false);
        expect(matchesPattern(pattern, "https://notapartments.com/")).toBe(false);
        expect(matchesPattern(pattern, "ftp://www.apartments.com/")).toBe(false);
    });

    it("matches an exact host with a port", () => {
        expect(matchesPattern("https://listings.example/*", "https://listings.example:8443/l/abc/")).toBe(true);
        expect(matchesPattern("https://listings.example/*", "https://www.listings.example/l/abc/")).toBe(false);
    });

    it("matches a path prefix and a bare-scheme pattern", () => {
        expect(matchesPattern("https://www.google.com/maps*", "https://www.google.com/maps/place/x")).toBe(true);
        expect(matchesPattern("https://www.google.com/maps*", "https://www.google.com/search")).toBe(false);
        expect(matchesPattern("<all_urls>", "https://anything.example/")).toBe(true);
        expect(matchesPattern("<all_urls>", "chrome-extension://abc/page.html")).toBe(false);
    });

    it("rejects a malformed pattern instead of matching everything", () => {
        expect(patternToRegExp("apartments.com")).toBeNull();
        expect(matchesPattern("apartments.com", "https://www.apartments.com/")).toBe(false);
    });

    it("answers for a list", () => {
        expect(matchesAny(["*://*.zillow.com/*", "*://*.apartments.com/*"], "https://www.zillow.com/homedetails/1_zpid/")).toBe(true);
        expect(matchesAny([], "https://www.zillow.com/")).toBe(false);
    });
});
