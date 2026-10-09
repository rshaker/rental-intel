import { describe, expect, it } from "vitest";
import { apartmentsSearch, apartmentsUrls } from "./urls";

describe("apartmentsUrls.parse", () => {
    it("recognises listing URLs by their two-segment shape", () => {
        expect(apartmentsUrls.parse("https://www.apartments.com/2630-n-hamlin-ave-chicago-il/kvl7tm9/")).toEqual({ sourceId: "kvl7tm9", kind: null });
        expect(apartmentsUrls.parse("https://www.apartments.com/the-juniper-austin-tx/abcdefg")).toEqual({ sourceId: "abcdefg", kind: null });
        expect(apartmentsUrls.parse("https://apartments.com/x-y/k4m2x9z/?utm=1")).toEqual({ sourceId: "k4m2x9z", kind: null });
    });

    it("refuses searches, pages, filtered searches and other hosts", () => {
        expect(apartmentsUrls.parse("https://www.apartments.com/austin-tx/")).toBeNull();
        expect(apartmentsUrls.parse("https://www.apartments.com/austin-tx/2/")).toBeNull();
        expect(apartmentsUrls.parse("https://www.apartments.com/austin-tx/2-bedrooms/")).toBeNull();
        expect(apartmentsUrls.parse("https://www.apartments.com/austin-tx/under-2000/")).toBeNull();
        expect(apartmentsUrls.parse("https://www.apartments.com/houses/austin-tx/")).toBeNull();
        expect(apartmentsUrls.parse("https://www.zillow.com/apartments/austin-tx/Cj8kQ2/")).toBeNull();
    });

    it("lets a neighbourhood page through, for the page to refuse", () => {
        // Same shape as a listing; nothing in the URL can tell. detect.ts decides.
        expect(apartmentsUrls.parse("https://www.apartments.com/austin-tx/downtown/")).toEqual({ sourceId: "downtown", kind: null });
    });
});

describe("apartmentsUrls.canonical", () => {
    it("drops tracking and normalises the host and trailing slash", () => {
        expect(apartmentsUrls.canonical("https://apartments.com/the-juniper-austin-tx/kvl7tm9?utm_source=share#pricing")).toBe(
            "https://www.apartments.com/the-juniper-austin-tx/kvl7tm9/",
        );
        expect(apartmentsUrls.canonical("https://elsewhere.example/x")).toBe("https://elsewhere.example/x");
    });
});

describe("apartmentsSearch", () => {
    it("opens the home page for any text, for the site's own box to resolve", () => {
        expect(apartmentsSearch.searchUrl("78701")).toBe("https://www.apartments.com/");
        expect(apartmentsSearch.searchUrl("Hyde Park, Austin, TX")).toBe("https://www.apartments.com/");
        expect(apartmentsSearch.searchUrl("   ")).toBeNull();
    });

    it("tells search pages from listings, neighbourhood pages and other sites", () => {
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx-78701/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/hyde-park-austin-tx/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx/2/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx/2-bedrooms/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/houses/austin-tx/")).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/the-juniper-austin-tx/abcdefg/")).toBe(false);
        // Parses as a listing by shape, so the page itself decides; not a search either.
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx/downtown/")).toBe(false);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/")).toBe(false);
        expect(apartmentsSearch.isSearchUrl("https://www.zillow.com/austin-tx/rentals/")).toBe(false);
    });
});

describe("apartmentsSearch.filteredUrl", () => {
    const filtered = (url: string, filters: Record<string, number | boolean | string>) => apartmentsSearch.filteredUrl!(url, filters);

    it("writes the two URLs the site's own filter panel wrote", () => {
        expect(filtered("https://www.apartments.com/austin-tx-78701/", { beds: 1, baths: 1, rentMin: 500, rentMax: 2000 })).toBe(
            "https://www.apartments.com/austin-tx-78701/min-1-bedrooms-1-bathrooms-500-to-2000/",
        );
        expect(filtered("https://www.apartments.com/austin-tx/", { typeApartments: true, typeCondos: true, dogs: true, cats: true, utilities: true, washerDryer: true, laundry: true })).toBe(
            "https://www.apartments.com/apartments-condos/austin-tx/pet-friendly-dog-and-cat/washer-dryer-laundry-facilities-utilities-included/",
        );
    });

    it("writes the combinations checked against the live site", () => {
        expect(filtered("https://www.apartments.com/austin-tx/", { typeApartments: true, typeCondos: true, beds: 1, baths: 1, rentMin: 500, rentMax: 2000, dogs: true, cats: true, washerDryer: true, utilities: true })).toBe(
            "https://www.apartments.com/apartments-condos/austin-tx/min-1-bedrooms-1-bathrooms-500-to-2000-pet-friendly-dog-and-cat/washer-dryer-utilities-included/",
        );
        expect(filtered("https://www.apartments.com/austin-tx/", { rentMin: 500, cats: true })).toBe("https://www.apartments.com/austin-tx/over-500-pet-friendly-cat/");
        expect(filtered("https://www.apartments.com/austin-tx/", { rentMax: 2000 })).toBe("https://www.apartments.com/austin-tx/under-2000/");
        expect(filtered("https://www.apartments.com/austin-tx/", { furnished: true })).toBe("https://www.apartments.com/austin-tx/furnished/");
    });

    it("rebuilds from the place: old filters and the page number go, the housing type stays", () => {
        expect(filtered("https://www.apartments.com/austin-tx/2-bedrooms-under-1500/3/", { beds: 2 })).toBe("https://www.apartments.com/austin-tx/min-2-bedrooms/");
        expect(filtered("https://www.apartments.com/houses/austin-tx/", { dogs: true })).toBe("https://www.apartments.com/houses/austin-tx/pet-friendly-dog/");
        expect(filtered("https://www.apartments.com/houses/austin-tx/", { typeApartments: true, typeCondos: true })).toBe("https://www.apartments.com/apartments-condos/austin-tx/");
        expect(filtered("https://www.apartments.com/austin-tx/", { rentMin: 2500, rentMax: 1000 })).toBe("https://www.apartments.com/austin-tx/1000-to-2500/");
        expect(filtered("https://www.apartments.com/austin-tx/", {})).toBe("https://www.apartments.com/austin-tx/");
    });

    it("has nothing for a page that is not a search", () => {
        expect(filtered("https://www.apartments.com/", { beds: 1 })).toBeNull();
        expect(filtered("https://www.apartments.com/the-juniper-austin-tx/abcdefg/", { beds: 1 })).toBeNull();
    });

    it("reads every URL it writes as a search page, and none as a listing", () => {
        const urls = [
            "https://www.apartments.com/apartments-condos/austin-tx/pet-friendly-dog-and-cat/washer-dryer-laundry-facilities-utilities-included/",
            "https://www.apartments.com/apartments-condos/austin-tx/pet-friendly-dog-and-cat/washer-dryer-laundry-facilities-utilities-included/2/",
            "https://www.apartments.com/austin-tx-78701/min-1-bedrooms-1-bathrooms-500-to-2000/",
            "https://www.apartments.com/austin-tx/furnished/",
            "https://www.apartments.com/austin-tx/studios/",
        ];
        for (const url of urls) {
            expect(apartmentsUrls.parse(url), url).toBeNull();
            expect(apartmentsSearch.isSearchUrl(url), url).toBe(true);
        }
    });

    it("writes the type, property, special and keyword filters the way the site's panel did", () => {
        expect(
            filtered("https://www.apartments.com/austin-tx/", { typeHouses: true, typeTownhomes: true, baths: 2, byOwner: true, newBuild: true, duplex: true, smallBuilding: true, lowIncome: true, specials: true, dishwasher: true, pool: true, keywords: "fireplace,  bike storage" }),
        ).toBe("https://www.apartments.com/houses-townhomes/austin-tx/2-bathrooms/for-rent-by-owner-recent-build-duplex-under-50-units/low-income-rent-specials-dishwasher-pool/?kw=fireplace%2Cbike+storage");
        expect(filtered("https://www.apartments.com/austin-tx/", { dishwasher: true })).toBe("https://www.apartments.com/austin-tx/dishwasher/");
        expect(filtered("https://www.apartments.com/austin-tx/", { den: true, clubhouse: true, washerDryerHookups: true })).toBe("https://www.apartments.com/austin-tx/washer_dryer-hookup-clubhouse-living-room/");
    });

    it("reads its own one-word filters after a place as searches, not listings", () => {
        for (const word of ["dishwasher", "parking", "garage", "fireplace", "basement", "elevator", "duplex", "concierge", "playground"]) {
            const url = `https://www.apartments.com/austin-tx/${word}/`;
            expect(apartmentsUrls.parse(url), url).toBeNull();
            expect(apartmentsSearch.isSearchUrl(url), url).toBe(true);
        }
        const long = "https://www.apartments.com/houses-townhomes/austin-tx/studios-2-bathrooms/for-rent-by-owner/low-income-dishwasher/2/";
        expect(apartmentsSearch.isSearchUrl(long)).toBe(true);
        expect(apartmentsSearch.isSearchUrl("https://www.apartments.com/austin-tx/washer_dryer-hookup/")).toBe(true);
    });

    it("offers each filter once, every one with a group", () => {
        const fields = apartmentsSearch.filters!;
        expect(new Set(fields.map((field) => field.key)).size).toBe(fields.length);
        expect(fields.length).toBe(51);
        expect([...new Set(fields.map((field) => field.group))]).toEqual(["Rent", "Rooms", "Pets", "Type", "Listing", "Unit", "Building", "Keywords"]);
    });
});
