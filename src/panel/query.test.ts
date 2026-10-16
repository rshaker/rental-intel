import { describe, expect, it } from "vitest";
import { emptyCore, rangeOf, type CoreFields, type Listing } from "../db/types";
import { DEFAULT_FILTERS, activeFilterCount, isUnitOf, matchesFilters, orderForDisplay, rangeBetween, relate, searchTerms, searchText, sortListings, type LinkIdsOf } from "./query";
import { parseFilters, parseSort } from "./schemas";

/** A listing with the given overrides. Everything else is unknown. */
function listing(id: string, core: Partial<CoreFields>, extra: Partial<Listing> = {}): Listing {
    return {
        id,
        source: "example",
        sourceId: id,
        url: `http://localhost:5174/l/${id}/`,
        kind: "home",
        core: { ...emptyCore(), ...core },
        detail: { version: 1, data: null },
        readMethod: "test",
        partial: false,
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

    it("filters by housing type and by every chosen feature", () => {
        const house = listing("house", { propertyType: "house", features: ["cats", "laundryInUnit"] });
        expect(matchesFilters(house, { ...DEFAULT_FILTERS, propertyType: "house" }, label())).toBe(true);
        expect(matchesFilters(house, { ...DEFAULT_FILTERS, propertyType: "condo" }, label())).toBe(false);
        expect(matchesFilters(cheap, { ...DEFAULT_FILTERS, propertyType: "house" }, label())).toBe(false);
        expect(matchesFilters(house, { ...DEFAULT_FILTERS, features: ["laundryInUnit"] }, label())).toBe(true);
        expect(matchesFilters(house, { ...DEFAULT_FILTERS, features: ["laundryInUnit", "pool"] }, label())).toBe(false);
        expect(matchesFilters(cheap, { ...DEFAULT_FILTERS, features: ["cats"] }, label())).toBe(false);
        expect(activeFilterCount({ ...DEFAULT_FILTERS, propertyType: "house", features: ["cats", "pool"] })).toBe(3);
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
    const PINE = { line1: "10 Pine St", unit: null, city: "Springfield", state: "IL", zip: "62701", text: "10 Pine St, Springfield, IL 62701" };
    const atPine = listing("pine", { address: PINE });
    const tower = listing(
        "tower",
        { name: "The Tower", plans: [{ id: "p", name: "A1", beds: 1, baths: 1, sqft: { min: 600, max: 600 }, rent: { min: 1800, max: 1800 }, availableUnits: 1, units: [{ id: "pine", name: "Unit 1", beds: 1, baths: 1, sqft: 600, rent: 1800, availableFrom: null, status: null, url: null }] }] },
        { kind: "building", sourceId: "TwrKey" },
    );
    /** Link ids as a source would read them: the tower answers to a lot id, two homes name it by key or lot. */
    const ids: LinkIdsOf = (l) => ({ aliases: l.id === "tower" ? ["lot:777"] : [], buildingIds: l.id === "bykey" ? ["TwrKey"] : l.id === "bylot" ? ["lot:777"] : [] });

    it("pairs listings of the same place on different sites, of the same kind only", () => {
        const dup = listing("dup", { address: { ...PINE, line1: "10 Pine Street", text: "10 Pine Street, Springfield" } }, { source: "zillow", sourceId: "1" });
        const asBuilding = listing("b", { address: PINE }, { kind: "building" });
        const relations = relate([atPine, mid, dup, asBuilding]);
        expect(relations.siblings.get("pine")?.map((l) => l.id)).toEqual(["dup"]);
        expect(relations.siblings.get("dup")?.map((l) => l.id)).toEqual(["pine"]);
        expect(relations.siblings.has("mid")).toBe(false);
        expect(relations.siblings.has("b")).toBe(false);
    });

    it("finds a home's building by the unit list, the key or an alias, on the same site only", () => {
        const bykey = listing("bykey", {});
        const bylot = listing("bylot", {});
        const other = listing("other", {}, { source: "zillow" });
        const relations = relate([atPine, tower, bykey, bylot, other], ids);
        expect(relations.unitsOf.get("tower")?.map((l) => l.id)).toEqual(["pine", "bykey", "bylot"]);
        expect(relations.buildingOf.get("pine")?.id).toBe("tower");
        expect(relations.buildingOf.has("other")).toBe(false);
        expect(relations.buildingOf.has("tower")).toBe(false);
        expect(isUnitOf(bylot, tower, ids)).toBe(true);
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
        expect(parseFilters('{"query":"pine","kind":"building","source":"zillow","priceMin":-5,"bedsMin":2,"status":"bogus","propertyType":"house","features":["cats","bogus","cats"]}')).toEqual({
            ...DEFAULT_FILTERS,
            query: "pine",
            kind: "building",
            source: "zillow",
            bedsMin: 2,
            propertyType: "house",
        });
        expect(parseFilters('{"features":["pool","cats"],"propertyType":"villa"}')).toEqual({ ...DEFAULT_FILTERS, features: ["pool", "cats"] });
        expect(parseFilters('{"features":"cats"}')).toEqual(DEFAULT_FILTERS);
        expect(parseSort("garbage")).toEqual({ key: "updatedAt", dir: "desc" });
        expect(parseSort('{"key":"price"}')).toEqual({ key: "price", dir: "asc" });
    });
});
