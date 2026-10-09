import { describe, expect, it } from "vitest";
import { zillowSearch } from "./urls";

/** The filtered search URL, held against the URLs Zillow's own filter panel wrote on 2026-10-04. */

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

    it("writes the filterState the site wrote for elevator, dishwasher and utilities, and leaves types alone when none is chosen", () => {
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { elevator: true, dishwasher: true, utilitiesIncluded: true })).filterState).toEqual({
            ...RENTALS,
            eaa: { value: true },
            dish: { value: true },
            uti: { value: true },
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
        // A filter the form does not own (sqft) is kept as the URL had it.
        expect(state.filterState).toEqual({ ...RENTALS, sort: { value: "priorityscore" }, beds: { min: 1 }, sqft: { min: 900 } });
    });

    it("writes both dog sizes", () => {
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { smallDogs: true, largeDogs: true })).filterState).toEqual({ ...RENTALS, sdog: { value: true }, ldog: { value: true } });
    });

    it("writes types, switching off the ones not chosen; apartments and condos share apco", () => {
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { typeHouses: true })).filterState).toEqual({ ...RENTALS, apco: { value: false }, sf: { value: true }, tow: { value: false } });
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { typeApartments: true, typeCondos: true })).filterState).toEqual({ ...RENTALS, apco: { value: true }, sf: { value: false }, tow: { value: false } });
    });

    it("writes keywords", () => {
        expect(stateOf(filtered("https://www.zillow.com/austin-tx/rentals/", { keywords: "  bike   storage " })).filterState).toEqual({ ...RENTALS, att: { value: "bike storage" } });
    });

    it("offers each filter once, in vocabulary order", () => {
        const fields = zillowSearch.filters!;
        expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length);
        expect([...new Set(fields.map((field) => field.group))]).toEqual(["Rent", "Rooms", "Type", "Pets", "Laundry", "Unit", "Building", "Listing", "Keywords"]);
    });

    it("writes a URL its own search test accepts, and has nothing for a listing", () => {
        expect(zillowSearch.isSearchUrl(filtered("https://www.zillow.com/austin-tx/rentals/", { beds: 2 }))).toBe(true);
        expect(zillowSearch.filteredUrl!("https://www.zillow.com/homedetails/1-Main-St/123_zpid/", { beds: 2 })).toBeNull();
    });
});
