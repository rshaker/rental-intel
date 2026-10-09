import { describe, expect, it } from "vitest";
import { emptyCore, rangeOf, type CoreFields, type Listing } from "../db/types";
import { DEFAULT_FILTERS, matchesFilters, orderForDisplay, rangeBetween, relate, searchTerms, searchText, sortListings } from "./query";
import { parseFilters, parseSort } from "./schemas";

/** A listing with the given overrides. Everything else is unknown. */
function listing(id: string, core: Partial<CoreFields>, extra: Partial<Listing> = {}): Listing {
    return {
        id,
        source: "example",
        sourceId: id,
        url: `https://listings.example/l/${id}/`,
        kind: "home",
        core: { ...emptyCore(), ...core },
        detail: { version: 1, data: null },
        via: "test",
        partial: false,
        propertyId: id,
        buildingId: null,
        answersTo: [],
        buildingRefs: [],
        user: { status: "none", notes: "", links: [] },
        createdAt: 1,
        updatedAt: 1,
        capturedAt: 1,
        ...extra,
    };
}

const label = () => "Example listings";

const cheap = listing("cheap", { rent: rangeOf(1200), beds: rangeOf(1), address: { line1: "10 Pine St", unit: null, city: "Springfield", state: "IL", zip: "62701", text: "10 Pine St, Springfield, IL 62701" } }, { updatedAt: 3 });
const mid = listing("mid", { rent: rangeOf(2000), beds: rangeOf(2), baths: rangeOf(1.5), amenities: ["In-unit laundry"] }, { updatedAt: 2, user: { status: "interested", notes: "great light", links: [] } });
const building = listing(
    "bldg",
    { name: "The Juniper", rent: { min: 1800, max: 3200 }, beds: { min: 0, max: 3 }, plans: [{ id: "p", name: "A1", beds: 1, baths: 1, sqft: rangeOf(600), rent: rangeOf(1800), availableUnits: 1, units: [{ id: "cheap", name: "Unit 1", beds: 1, baths: 1, sqft: 600, rent: 1800, availableFrom: null, status: null, url: null }] }] },
    { kind: "building", updatedAt: 1 },
);

describe("searchText and searchTerms", () => {
    it("indexes what the site said and what the user wrote", () => {
        const text = searchText(mid, "Example listings");
        expect(text).toContain("in-unit laundry");
        expect(text).toContain("great light");
        expect(text).toContain("interested");
        expect(text).toContain("example listings");
    });

    it("splits terms and keeps quoted phrases", () => {
        expect(searchTerms(' Laundry "no pets"  springfield ')).toEqual(["laundry", "no pets", "springfield"]);
        expect(searchTerms("")).toEqual([]);
    });
});

describe("matchesFilters", () => {
    it("needs every search term somewhere", () => {
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, query: "laundry light" }, label())).toBe(true);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, query: "laundry pool" }, label())).toBe(false);
        expect(matchesFilters(cheap, { ...DEFAULT_FILTERS, query: "pine" }, label())).toBe(true);
    });

    it("treats a rent bound as a question a null cannot answer", () => {
        expect(matchesFilters(cheap, { ...DEFAULT_FILTERS, priceMax: 1500 }, label())).toBe(true);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, priceMax: 1500 }, label())).toBe(false);
        expect(matchesFilters(listing("x", {}), { ...DEFAULT_FILTERS, priceMax: 1500 }, label())).toBe(false);
    });

    it("lets a building through when any of its plans could match", () => {
        expect(matchesFilters(building, { ...DEFAULT_FILTERS, priceMax: 2000 }, label())).toBe(true);
        expect(matchesFilters(building, { ...DEFAULT_FILTERS, priceMin: 3500 }, label())).toBe(false);
        expect(matchesFilters(building, { ...DEFAULT_FILTERS, bedsMin: 3 }, label())).toBe(true);
        expect(matchesFilters(building, { ...DEFAULT_FILTERS, bedsMin: 4 }, label())).toBe(false);
    });

    it("filters by kind, source, status and baths", () => {
        expect(matchesFilters(building, { ...DEFAULT_FILTERS, kind: "home" }, label())).toBe(false);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, source: "zillow" }, label())).toBe(false);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, status: "interested" }, label())).toBe(true);
        expect(matchesFilters(cheap, { ...DEFAULT_FILTERS, status: "interested" }, label())).toBe(false);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, bathsMin: 1.5 }, label())).toBe(true);
        expect(matchesFilters(mid, { ...DEFAULT_FILTERS, bathsMin: 2 }, label())).toBe(false);
    });
});

describe("sortListings and orderForDisplay", () => {
    it("sorts by rent with unknowns last in both directions", () => {
        const unknown = listing("unknown", {});
        const asc = sortListings([mid, unknown, cheap], { key: "price", dir: "asc" }).map((l) => l.id);
        const desc = sortListings([mid, unknown, cheap], { key: "price", dir: "desc" }).map((l) => l.id);
        expect(asc).toEqual(["cheap", "mid", "unknown"]);
        expect(desc).toEqual(["mid", "cheap", "unknown"]);
    });

    it("floats the active listing only in the default view", () => {
        const all = [cheap, mid, building];
        expect(orderForDisplay(all, DEFAULT_FILTERS, { key: "updatedAt", dir: "desc" }, "bldg", label).map((l) => l.id)).toEqual(["bldg", "cheap", "mid"]);
        expect(orderForDisplay(all, DEFAULT_FILTERS, { key: "price", dir: "asc" }, "bldg", label).map((l) => l.id)).toEqual(["cheap", "bldg", "mid"]);
    });
});

describe("relate", () => {
    it("reads siblings off the shared property id and units off the building id", () => {
        const twin = listing("twin", {}, { source: "example", sourceId: "twin", propertyId: "cheap" });
        const unit = listing("unit", {}, { buildingId: "bldg" });
        const orphan = listing("orphan", {}, { buildingId: "gone" });
        const relations = relate([cheap, mid, building, twin, unit, orphan]);
        expect(relations.siblings.get("cheap")?.map((l) => l.id)).toEqual(["twin"]);
        expect(relations.siblings.get("twin")?.map((l) => l.id)).toEqual(["cheap"]);
        expect(relations.siblings.has("mid")).toBe(false);
        expect(relations.unitsOf.get("bldg")?.map((l) => l.id)).toEqual(["unit"]);
        expect(relations.buildingOf.get("unit")?.id).toBe("bldg");
        expect(relations.buildingOf.has("orphan")).toBe(false); // its building was deleted
    });
});

describe("rangeBetween", () => {
    it("spans the anchor and the target in either order", () => {
        expect(rangeBetween(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"]);
        expect(rangeBetween(["a", "b", "c", "d"], "d", "b")).toEqual(["b", "c", "d"]);
        expect(rangeBetween(["a", "b"], "gone", "b")).toEqual(["b"]);
        expect(rangeBetween(["a", "b"], "a", "gone")).toEqual([]);
    });
});

describe("persistence", () => {
    it("reads stored filters and sorts without trusting them", () => {
        expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
        expect(parseFilters('{"query":"pine","kind":"building","source":"zillow","priceMin":-5,"bedsMin":2,"status":"bogus"}')).toEqual({
            ...DEFAULT_FILTERS,
            query: "pine",
            kind: "building",
            source: "zillow",
            bedsMin: 2,
        });
        expect(parseSort("garbage")).toEqual({ key: "updatedAt", dir: "desc" });
        expect(parseSort('{"key":"price"}')).toEqual({ key: "price", dir: "asc" });
    });
});
