import { describe, expect, it } from "vitest";
import { parseUrlList } from "./urlList";

// The example source is in the registry under test (vitest defines __E2E__).
const enabled = () => true;
const nothingEnabled = () => false;

describe("parseUrlList", () => {
    it("reads one listing URL per line, forgiving the scheme and trailing notes", () => {
        const parsed = parseUrlList(
            [
                "# a comment",
                "",
                "https://listings.example/l/abcd1234/",
                "listings.example/l/efgh5678 -- the one with the view",
                "  https://listings.example/l/abcd1234/?utm=x  ",
            ].join("\n"),
            enabled,
        );
        expect(parsed.entries.map((e) => e.ref.sourceId)).toEqual(["abcd1234", "efgh5678"]);
        expect(parsed.entries[0]?.url).toBe("https://listings.example/l/abcd1234/");
        expect(parsed.entries[0]?.ref.source).toBe("example");
        expect(parsed.duplicates).toBe(1);
        expect(parsed.skipped).toEqual([]);
    });

    it("reports lines that are not listing URLs of a known site", () => {
        const parsed = parseUrlList("https://listings.example/search/springfield/\nhttps://unknown.example/l/abcd1234/\nnot a url at all", enabled);
        expect(parsed.entries).toEqual([]);
        expect(parsed.skipped).toHaveLength(3);
    });

    it("reports listings of a site that is not enabled", () => {
        const parsed = parseUrlList("https://listings.example/l/abcd1234/", nothingEnabled);
        expect(parsed.entries).toEqual([]);
        expect(parsed.disabled).toEqual([{ line: "https://listings.example/l/abcd1234/", source: "Example listings" }]);
    });
});
