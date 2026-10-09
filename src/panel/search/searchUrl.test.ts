import { describe, expect, it } from "vitest";
import { example } from "../../sources/example/descriptor";
import { zillow } from "../../sources/zillow/descriptor";
import { resolveSearchUrl } from "./searchUrl";

describe("resolveSearchUrl", () => {
    it("turns free text into the source's search URL", () => {
        expect(resolveSearchUrl(example, "Hyde Park, Austin, TX")).toBe("https://listings.example/search/hyde-park-austin-tx/");
        expect(resolveSearchUrl(example, "  Springfield  ")).toBe("https://listings.example/search/springfield/");
    });

    it("uses a URL on the site as it is, search page or not", () => {
        expect(resolveSearchUrl(example, "https://listings.example/search/springfield/?page=2")).toBe("https://listings.example/search/springfield/?page=2");
        expect(resolveSearchUrl(example, "https://listings.example/l/juniper01/")).toBe("https://listings.example/l/juniper01/");
    });

    it("refuses blank text, another site's URL and a malformed one", () => {
        expect(resolveSearchUrl(example, "   ")).toBeNull();
        expect(resolveSearchUrl(example, "...")).toBeNull();
        expect(resolveSearchUrl(example, "https://www.zillow.com/austin-tx/rentals/")).toBeNull();
        expect(resolveSearchUrl(example, "http://")).toBeNull();
    });

    it("refuses a source that cannot be searched", () => {
        const unsearchable = { ...zillow, search: undefined };
        expect(resolveSearchUrl(unsearchable, "Springfield")).toBeNull();
        // Its own URLs still pass through: the page can be opened regardless.
        expect(resolveSearchUrl(unsearchable, "https://www.zillow.com/austin-tx/rentals/")).toBe("https://www.zillow.com/austin-tx/rentals/");
    });
});
