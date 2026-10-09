import { describe, expect, it } from "vitest";
import { detectListing, extractCapture } from "../../content/detect";
import { examplePage } from "./page";
import { slugify } from "../shared/slug";
import { soonest } from "../shared/values";
import { exampleSearch, exampleUrls } from "./urls";

/**
 * The example source, read closely: what its extractor makes of its own
 * fixtures. fixtures.test.ts checks every source the same shallow way; this
 * pins the field mapping, as a real source's page.test.ts should.
 */

const FIXTURES = import.meta.glob("../../../playwright/fixtures/example-*.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function fixture(name: string): Document {
    const path = Object.keys(FIXTURES).find((key) => key.endsWith(`/${name}`));
    if (!path) throw new Error(`no fixture ${name}`);
    return new DOMParser().parseFromString(FIXTURES[path]!, "text/html");
}

describe("exampleUrls", () => {
    it("recognises listing URLs and nothing else", () => {
        expect(exampleUrls.parse("https://listings.example/l/juniper01/")).toEqual({ sourceId: "juniper01", kind: null });
        expect(exampleUrls.parse("https://listings.example/l/juniper01")).toEqual({ sourceId: "juniper01", kind: null });
        expect(exampleUrls.parse("https://listings.example/search/springfield/")).toBeNull();
        expect(exampleUrls.parse("https://other.example/l/juniper01/")).toBeNull();
        expect(exampleUrls.parse("not a url")).toBeNull();
    });

    it("builds and canonicalises", () => {
        expect(exampleUrls.listing("juniper01")).toBe("https://listings.example/l/juniper01/");
        expect(exampleUrls.canonical("https://listings.example/l/juniper01?utm_source=x")).toBe("https://listings.example/l/juniper01/");
        expect(exampleUrls.canonical("https://listings.example/search/")).toBe("https://listings.example/search/");
    });
});

describe("exampleSearch", () => {
    it("slugs free text the way the site does", () => {
        expect(slugify("Hyde Park, Austin, TX")).toBe("hyde-park-austin-tx");
        expect(slugify("  78705 ")).toBe("78705");
        expect(slugify("...")).toBe("");
    });

    it("builds a search URL from text, or nothing from nothing", () => {
        expect(exampleSearch.searchUrl("Springfield, IL")).toBe("https://listings.example/search/springfield-il/");
        expect(exampleSearch.searchUrl("   ")).toBeNull();
    });

    it("tells search pages from the rest", () => {
        expect(exampleSearch.isSearchUrl("https://listings.example/search/springfield/")).toBe(true);
        expect(exampleSearch.isSearchUrl("https://listings.example/search/springfield")).toBe(true);
        expect(exampleSearch.isSearchUrl("https://listings.example/l/juniper01/")).toBe(false);
        expect(exampleSearch.isSearchUrl("https://other.example/search/springfield/")).toBe(false);
        expect(exampleSearch.isSearchUrl("https://listings.example/search/springfield/?beds=2")).toBe(true);
    });
});

describe("exampleSearch.filteredUrl", () => {
    it("puts the filters in the query, replacing any already there", () => {
        expect(exampleSearch.filteredUrl!("https://listings.example/search/springfield-il/", { beds: 2 })).toBe("https://listings.example/search/springfield-il/?beds=2");
        expect(exampleSearch.filteredUrl!("https://listings.example/search/springfield-il/?beds=4", { rentMax: 2500, pets: true })).toBe("https://listings.example/search/springfield-il/?max=2500&pets=1");
        expect(exampleSearch.filteredUrl!("https://listings.example/l/juniper01/", { beds: 2 })).toBeNull();
    });
});

describe("example search page", () => {
    const doc = fixture("example-search.html");
    const url = "https://listings.example/search/springfield/";

    it("lists its results, each a link with its price and facts", () => {
        expect(examplePage.searchResults!(doc, url)).toEqual([
            {
                title: "The Juniper Lofts",
                url: "https://listings.example/l/juniper01/",
                priceText: "$1,895 – $2,850",
                price: 1895,
                factsText: "Studio – 2bd · 1 – 2ba",
                ref: { sourceId: "juniper01", kind: null },
            },
            {
                title: "118 Pecan St Unit B",
                url: "https://listings.example/l/pecan00b/",
                priceText: "$2,400",
                price: 2400,
                factsText: "2bd/1ba · 1,150 sqft",
                ref: { sourceId: "pecan00b", kind: null },
            },
        ]);
    });

    it("is still refused as a listing", () => {
        expect(detectListing(examplePage, doc, url).confirmed).toBe(false);
        expect(extractCapture(examplePage, doc, url)).toBeNull();
    });

    it("reads nothing off a listing page, or off a search page at a listing URL", () => {
        expect(examplePage.searchResults!(fixture("example-building.html"), "https://listings.example/l/juniper01/")).toBeNull();
        expect(examplePage.searchResults!(doc, "https://listings.example/l/juniper01/")).toBeNull();
    });
});

describe("example building page", () => {
    const doc = fixture("example-building.html");
    const url = "https://listings.example/l/juniper01/";

    it("is confirmed by the structured signals and the furniture", () => {
        const detection = detectListing(examplePage, doc, url);
        expect(detection.confirmed).toBe(true);
        expect(detection.score).toBe(7);
        expect(detection.signals.map((s) => [s.name, s.present])).toEqual([
            ["jsonld", true],
            ["canonical", true],
            ["og:url", true],
            ["payload", true],
            ["markers", true],
        ]);
    });

    it("refuses to confirm the page for another listing's URL", () => {
        const detection = detectListing(examplePage, doc, "https://listings.example/l/someoneelse/");
        expect(detection.confirmed).toBe(false);
        expect(detection.conflict).toBe(true);
    });

    it("maps the payload onto core", () => {
        const capture = extractCapture(examplePage, doc, url)!;
        expect(capture.kind).toBe("building");
        expect(capture.core.name).toBe("The Juniper Lofts");
        expect(capture.core.address).toEqual({ line1: "4200 Juniper Ln", unit: null, city: "Springfield", state: "IL", zip: "62704", text: "4200 Juniper Ln, Springfield, IL 62704" });
        expect(capture.core.geo).toEqual({ lat: 39.7991, lng: -89.6443 });
        expect(capture.core.rent).toEqual({ min: 1895, max: 2850 });
        expect(capture.core.beds).toEqual({ min: 1, max: 2 });
        expect(capture.core.baths).toEqual({ min: 1, max: 2 });
        expect(capture.core.sqft).toEqual({ min: 620, max: 980 });
        expect(capture.core.plans.map((p) => [p.name, p.units.length])).toEqual([["A1", 2], ["B2", 1]]);
        expect(capture.core.plans[0]!.units[0]).toMatchObject({ id: "u101", name: "Unit 101", rent: 1895, availableFrom: "now" });
        expect(capture.core.plans[0]!.units[1]!.availableFrom).toBe("2026-11-01");
        expect(capture.core.plans[1]!.units[0]!.availableFrom).toBe("2026-10-15");
        expect(capture.core.availableUnits).toBe(3);
        expect(capture.core.availableFrom).toBe("now");
        expect(capture.core.propertyType).toBe("apartment");
        expect(capture.core.photoUrls).toHaveLength(3);
        expect(capture.core.amenities).toEqual(["In-unit laundry", "Rooftop deck", "Bike storage"]);
        expect(capture.core.pets).toBe("Cats and dogs welcome, $50/mo pet rent");
        expect(capture.core.contact.phone).toBe("(217) 555-0142");
        expect(capture.core.description).toMatch(/^A mid-rise community/);
        expect(capture.detail).toEqual({ version: 1, data: { listingId: "juniper01", rating: 4.2, unitIds: ["u101", "u305", "u412"] } });
    });
});

describe("example home page", () => {
    const doc = fixture("example-home.html");
    const url = "https://listings.example/l/pecan00b/";

    it("reads as a home with one-value ranges", () => {
        const capture = extractCapture(examplePage, doc, url)!;
        expect(capture.kind).toBe("home");
        expect(capture.core.rent).toEqual({ min: 2400, max: 2400 });
        expect(capture.core.beds).toEqual({ min: 2, max: 2 });
        expect(capture.core.sqft).toEqual({ min: 1150, max: 1150 });
        expect(capture.core.propertyType).toBe("house");
        expect(capture.core.availableFrom).toBe("2026-12-01");
        expect(capture.core.address.line1).toBe("118 Pecan St Unit B");
        expect(capture.core.photoUrls).toEqual(["https://photos.listings.example/pecan00b/1.jpg"]);
    });
});

describe("soonest", () => {
    it("prefers now, then the earliest date, and ignores prose", () => {
        expect(soonest(["2026-11-01", "2026-10-15"])).toBe("2026-10-15");
        expect(soonest(["2026-11-01", "now"])).toBe("now");
        expect(soonest(["Call for details", null])).toBeNull();
    });
});
