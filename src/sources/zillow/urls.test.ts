import { describe, expect, it } from "vitest";
import { zillowSearch } from "./urls";

/**
 * The filtered search URL, held against the two URLs Zillow's own filter
 * panel wrote on 2026-10-04 (their `filterState`s are copied here whole).
 */

const stateOf = (url: string): Record<string, any> => JSON.parse(new URL(url).searchParams.get("searchQueryState")!);
const off = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, { value: false }]));
const RENTALS = { fr: { value: true }, ...off("fsba", "fsbo", "nc", "lsact", "cmsn", "lscmsn", "lszp", "auc", "fore", "mf", "land", "manu") };

describe("zillowSearch.filteredUrl", () => {
    const filtered = (url: string, filters: Record<string, number | boolean | string>) => zillowSearch.filteredUrl!(url, filters)!;

    it("writes the filterState the site wrote for rooms, rent and cats", () => {
        const url = filtered("https://www.zillow.com/austin-tx/rentals/", { beds: 1, baths: 1, rentMin: 500, rentMax: 2000, cats: true });
        expect(new URL(url).pathname).toBe("/austin-tx/rentals/");
        expect(stateOf(url)).toEqual({
            pagination: {},
            filterState: { ...RENTALS, beds: { min: 1 }, baths: { min: 1 }, mp: { min: 500, max: 2000 }, cat: { value: true } },
        });
    });

    it("writes the filterState the site wrote for type, amenities and size", () => {
        const url = filtered("https://www.zillow.com/austin-tx/rentals/", { typeApartments: true, elevator: true, dishwasher: true, utilities: true, sqftMin: 500 });
        expect(stateOf(url).filterState).toEqual({
            ...RENTALS,
            ...off("sf", "tow"),
            eaa: { value: true },
            dish: { value: true },
            uti: { value: true },
            sqft: { min: 500 },
        });
    });

    it("says for rent and nothing for sale even with one filter: the site answers `fr` alone with no homes", () => {
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { rentMax: 2000 })).filterState).toEqual({ ...RENTALS, mp: { max: 2000 } });
    });

    it("keeps a state the URL already has, less its page and the filters the form owns", () => {
        const given = {
            pagination: { currentPage: 3 },
            isMapVisible: true,
            mapBounds: { west: -122.6, east: -122.0, south: 47.4, north: 47.7 },
            regionSelection: [{ regionId: 16037, regionType: 6 }],
            filterState: { sort: { value: "priorityscore" }, fr: { value: true }, beds: { min: 3 }, cat: { value: true }, sqft: { min: 900 } },
        };
        const url = filtered(`https://www.zillow.com/austin-tx/rentals/3_p/?searchQueryState=${encodeURIComponent(JSON.stringify(given))}`, { beds: 1 });
        expect(new URL(url).pathname).toBe("/austin-tx/rentals/");
        const state = stateOf(url);
        expect(state.pagination).toEqual({});
        expect(state.mapBounds).toEqual(given.mapBounds);
        expect(state.regionSelection).toEqual(given.regionSelection);
        expect(state.filterState).toEqual({ ...RENTALS, sort: { value: "priorityscore" }, beds: { min: 1 } });
    });

    it("writes the rest of the site's dictionary: dogs, types, size, amenities, keywords", () => {
        const state = stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { smallDogs: true, largeDogs: true, typeHouses: true, typeTownhomes: true, sqftMin: 1200, sqftMax: 400, airConditioning: true, laundry: true, parking: true, byOwner: true, viewWater: true, keywords: "  bike   storage " }));
        expect(state.filterState).toEqual({
            ...RENTALS,
            sdog: { value: true },
            ldog: { value: true },
            apco: { value: false },
            sqft: { min: 400, max: 1200 },
            ac: { value: true },
            lau: { value: true },
            parka: { value: true },
            frbo: { value: true },
            watv: { value: true },
            att: { value: "bike storage" },
        });
    });

    it("offers each filter once", () => {
        const fields = zillowSearch.filters!;
        expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length);
        expect([...new Set(fields.map((field) => field.group))]).toEqual(["Rent", "Rooms", "Sq ft", "Pets", "Type", "Listing", "Unit", "Building", "View", "Keywords"]);
    });

    it("writes a URL its own search test accepts, and has nothing for a listing", () => {
        expect(zillowSearch.isSearchUrl(filtered("https://www.zillow.com/austin-tx/rentals/", { beds: 2 }))).toBe(true);
        expect(zillowSearch.filteredUrl!("https://www.zillow.com/homedetails/1-Main-St/123_zpid/", { beds: 2 })).toBeNull();
    });
});
