import { describe, expect, it } from "vitest";
import { emptyCore, type CoreFields, type Listing } from "./types";
import { isUnitOf, place, placeAll, relationFields, unitsToAttach } from "./relations";

/**
 * How a listing finds its twins and its building, as the save decides it.
 * Plain objects stand in for rows; nothing here touches Dexie.
 */

function listing(id: string, core: Partial<CoreFields> = {}, extra: Partial<Listing> = {}): Listing {
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

const PINE = { line1: "10 Pine St", unit: null, city: "Springfield", state: "IL", zip: "62701", text: "10 Pine St, Springfield, IL 62701" };
const cheap = listing("cheap", { address: PINE });
const tower = listing("tower", { name: "The Tower", plans: [{ id: "p", name: "A1", beds: 1, baths: 1, sqft: { min: 600, max: 600 }, rent: { min: 1800, max: 1800 }, availableUnits: 1, units: [{ id: "cheap", name: "Unit 1", beds: 1, baths: 1, sqft: 600, rent: 1800, availableFrom: null, status: null, url: null }] }] }, { kind: "building", sourceId: "TwrKey", answersTo: ["lot:777"] });

describe("place", () => {
    it("joins the property of a twin on another site, else keeps or mints its own", () => {
        const twin = listing("twin", { address: { ...PINE, line1: "10 Pine Street", text: "10 Pine Street, Springfield" } }, { source: "zillow", sourceId: "1" });
        expect(place({ ...twin, propertyId: undefined }, [cheap]).propertyId).toBe("cheap");
        expect(place({ ...twin, propertyId: "mine" }, []).propertyId).toBe("mine");
        expect(place({ ...twin, propertyId: undefined }, []).propertyId).toMatch(/^[0-9a-f]{16}$/);
        // Its own earlier row is never its twin; a building is not a home's twin.
        expect(place({ ...cheap, propertyId: undefined }, [cheap]).propertyId).not.toBe("cheap");
        expect(place({ ...listing("b", { address: PINE }, { kind: "building" }), propertyId: undefined }, [cheap]).propertyId).not.toBe("cheap");
    });

    it("finds a home's building by the unit list, the key or the lot id, on the same site only", () => {
        expect(place(cheap, [tower]).buildingId).toBe("tower");
        expect(place(listing("bykey", {}, { buildingRefs: ["TwrKey"] }), [tower]).buildingId).toBe("tower");
        expect(place(listing("bylot", {}, { buildingRefs: ["lot:777"] }), [tower]).buildingId).toBe("tower");
        expect(place(listing("other", {}, { source: "zillow", buildingRefs: ["TwrKey"] }), [tower]).buildingId).toBeNull();
        expect(place(tower, [cheap]).buildingId).toBeNull();
    });
});

describe("unitsToAttach", () => {
    it("names the saved homes a building adopts when it is saved", () => {
        const linked = listing("linked", {}, { buildingRefs: ["TwrKey"], buildingId: "tower" });
        const loose = listing("loose", {}, { buildingRefs: ["lot:777"] });
        expect(unitsToAttach(tower, [cheap, linked, loose]).map((l) => l.id)).toEqual(["cheap", "loose"]);
        expect(isUnitOf(loose, tower)).toBe(true);
    });
});

describe("placeAll", () => {
    it("places every listing in order, twins sharing the first one's id", () => {
        const a = listing("a", { address: PINE }, { propertyId: "" });
        const b = listing("b", { address: PINE }, { source: "zillow", sourceId: "9", propertyId: "" });
        const t = { ...tower, propertyId: "" };
        const rows = [a, b, t];
        placeAll(rows);
        expect(a.propertyId).toMatch(/^[0-9a-f]{16}$/);
        expect(b.propertyId).toBe(a.propertyId);
        expect(t.propertyId).not.toBe(a.propertyId);
        expect(a.buildingId).toBeNull();
        expect(t.buildingId).toBeNull();
    });
});

describe("relationFields", () => {
    it("reads Zillow's lot and building ids and nothing for a source without them", () => {
        expect(relationFields("zillow", { version: 1, data: { lotId: "5", buildingKey: "K", buildingLotId: "6" } })).toEqual({ answersTo: ["lot:5"], buildingRefs: ["K", "lot:6"] });
        expect(relationFields("zillow", { version: 99, data: {} })).toEqual({ answersTo: [], buildingRefs: [] });
        expect(relationFields("example", { version: 1, data: null })).toEqual({ answersTo: [], buildingRefs: [] });
    });
});
