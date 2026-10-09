import { describe, expect, it } from "vitest";
import { detectListing, extractCapture } from "../../content/detect";
import { zillowPage } from "./page";
import { availabilityFrom, buildingFrom, homeFrom, propertyTypeFrom, unitStatusFrom } from "./page/fields";
import type { ZillowDetail } from "./types";
import { kindOfZillowId, zillowSearch, zillowUrls } from "./urls";
import { statusText, zillowWord } from "./view";

/**
 * The Zillow source against its real fixtures (trimmed captures, October
 * 2026, Austin, TX): the URL parser, each probe, the field mapping of both kinds, and
 * the conversion of the previous extension's backups.
 */

const FIXTURES = import.meta.glob("../../../playwright/fixtures/zillow-*.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function fixture(name: string): Document {
    const path = Object.keys(FIXTURES).find((key) => key.endsWith(`/${name}`));
    if (!path) throw new Error(`no fixture ${name}`);
    return new DOMParser().parseFromString(FIXTURES[path]!, "text/html");
}

const HOME_URL = "https://www.zillow.com/homedetails/710-E-Dean-Keeton-St-111-Austin-TX-78705/450233440_zpid/";
const BUILDING_URL = "https://www.zillow.com/apartments/austin-tx/lenox-grand/CmB93F/";

describe("zillowSearch", () => {
    it("builds the site's own free-text search URL", () => {
        expect(zillowSearch.searchUrl("Austin, TX")).toBe("https://www.zillow.com/homes/for_rent/Austin,-TX_rb/");
        expect(zillowSearch.searchUrl("  Hyde Park   Austin ")).toBe("https://www.zillow.com/homes/for_rent/Hyde-Park-Austin_rb/");
        expect(zillowSearch.searchUrl("78705")).toBe("https://www.zillow.com/homes/for_rent/78705_rb/");
        expect(zillowSearch.searchUrl("   ")).toBeNull();
    });

    it("tells search pages from listings and other sites", () => {
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/homes/for_rent/Austin,-TX_rb/")).toBe(true);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/austin-tx/rentals/")).toBe(true);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/austin-tx/rentals/2_p/")).toBe(true);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/portland-or/apartments/")).toBe(true);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/apartments/austin-tx/hyde-park/")).toBe(true);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/homes/for_rent/?searchQueryState=%7B%7D")).toBe(true);
        expect(zillowSearch.isSearchUrl(HOME_URL)).toBe(false);
        expect(zillowSearch.isSearchUrl(BUILDING_URL)).toBe(false);
        expect(zillowSearch.isSearchUrl("https://www.zillow.com/")).toBe(false);
        expect(zillowSearch.isSearchUrl("https://www.apartments.com/austin-tx/")).toBe(false);
    });

    it("reads nothing off a listing page, or off the synthetic search page, which has no list", () => {
        expect(zillowPage.searchResults!(fixture("zillow-listing.html"), HOME_URL)).toBeNull();
        expect(zillowPage.searchResults!(fixture("zillow-search.html"), "https://www.zillow.com/portland-or/rentals/")).toBeNull();
    });

    it("names the next page from the site's pagination, nothing on the last page, and the bot check as a challenge", () => {
        const paged = (links: string, title = "Rental Listings"): Document => new DOMParser().parseFromString(`<html><head><title>${title}</title></head><body><div class="search-pagination"><nav aria-label="Pagination">${links}</nav></div></body></html>`, "text/html");
        const first = paged('<a rel="prev" href="/austin-tx-78705/rentals/" aria-disabled="true">Previous page</a><a rel="next" href="/austin-tx-78705/rentals/2_p/">Next page</a>');
        expect(zillowPage.searchNextUrl!(first, "https://www.zillow.com/homes/for_rent/78705_rb/")).toBe("https://www.zillow.com/austin-tx-78705/rentals/2_p/");
        const last = paged('<a rel="prev" href="/austin-tx-78705/rentals/7_p/">Previous page</a><a rel="next" href="/austin-tx-78705/rentals/8_p/" aria-disabled="true">Next page</a>');
        expect(zillowPage.searchNextUrl!(last, "https://www.zillow.com/austin-tx-78705/rentals/8_p/")).toBeNull();
        expect(zillowPage.searchNextUrl!(first, HOME_URL)).toBeNull();
        // A filtered search: the site's link drops the filters (and the home type), so only its page number is used.
        const state = { pagination: {}, filterState: { fr: { value: true }, mp: { max: 2000 }, cat: { value: true } } };
        const at = (path: string, s: object) => `https://www.zillow.com${path}?searchQueryState=${encodeURIComponent(JSON.stringify(s))}`;
        const second = zillowPage.searchNextUrl!(first, at("/austin-tx-78705/apartments/", state))!;
        expect(new URL(second).pathname).toBe("/austin-tx-78705/apartments/2_p/");
        expect(JSON.parse(new URL(second).searchParams.get("searchQueryState")!)).toEqual({ ...state, pagination: { currentPage: 2 } });
        const mid = paged('<a rel="next" href="/austin-tx-78705/rentals/3_p/">Next page</a>');
        const third = zillowPage.searchNextUrl!(mid, second)!;
        expect(new URL(third).pathname).toBe("/austin-tx-78705/apartments/3_p/");
        expect(JSON.parse(new URL(third).searchParams.get("searchQueryState")!).pagination).toEqual({ currentPage: 3 });
        expect(zillowPage.searchNextUrl!(last, at("/austin-tx-78705/apartments/8_p/", { ...state, pagination: { currentPage: 8 } }))).toBeNull();
        expect(zillowPage.challenge!(first, "https://www.zillow.com/austin-tx-78705/rentals/")).toBeNull();
        expect(zillowPage.challenge!(paged("", "Access to this page has been denied"), "https://www.zillow.com/austin-tx-78705/rentals/2_p/")).toMatch(/prove you are a person/);
    });

    it("reads the list out of a search payload, and the cards without one", () => {
        const payload = {
            props: {
                pageProps: {
                    searchPageState: {
                        cat1: {
                            searchResults: {
                                listResults: [
                                    { zpid: "450233440", detailUrl: "/homedetails/710-E-Dean-Keeton-St-111-Austin-TX-78705/450233440_zpid/", address: "710 E Dean Keeton St #111, Austin, TX 78705", price: "$1,150/mo", unformattedPrice: 1150, beds: 1, baths: 1, area: 600 },
                                    { detailUrl: "https://www.zillow.com/apartments/austin-tx/lenox-grand/CmB93F/", buildingName: "Lenox Grand", price: "$1,426+", minBeds: 0 },
                                    { detailUrl: "/apartments/austin-tx/the-arbor/Cj8kQ2/", address: "The Arbor, 1800 Lavaca St #503, Austin, TX 78701", addressStreet: "1800 Lavaca St #503", addressCity: "Austin", addressState: "TX", addressZipcode: "78701", price: "$1,900/mo", beds: 1, baths: 1 },
                                    { detailUrl: "/apartments/austin-tx/pecan-flats/5Xk9Qa/", address: "Pecan Flats | Renovated Studios & One Bedrooms, 2200 Nueces St #101, Austin, TX 78705", price: "$1,825/mo" },
                                    { detailUrl: "/apartments/austin-tx/mesa-court/5Xm2wT/", address: "4100 Duval St, Austin, TX", addressStreet: "4100 Duval St  # 423", addressCity: "Austin", addressState: "TX", addressZipcode: "78751", buildingName: "Mesa Court", isBuilding: true, price: "$1,700+" },
                                    { address: "no page" },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const doc = new DOMParser().parseFromString(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`, "text/html");
        expect(zillowPage.searchResults!(doc, "https://www.zillow.com/austin-tx/rentals/")).toEqual([
            { title: "710 E Dean Keeton St #111, Austin, TX 78705", url: HOME_URL, priceText: "$1,150/mo", price: 1150, factsText: "1bd/1ba · 600 sqft", ref: { sourceId: "450233440", kind: "home" } },
            { title: "Lenox Grand", url: BUILDING_URL, priceText: "$1,426+", price: 1426, factsText: "Studio", ref: { sourceId: "CmB93F", kind: "building" } },
            // The address heads the row; the name the site ran into it, or gave beside it, ends the facts.
            { title: "1800 Lavaca St #503, Austin, TX 78701", url: "https://www.zillow.com/apartments/austin-tx/the-arbor/Cj8kQ2/", priceText: "$1,900/mo", price: 1900, factsText: "1bd/1ba · The Arbor", ref: { sourceId: "Cj8kQ2", kind: "building" } },
            { title: "2200 Nueces St #101, Austin, TX 78705", url: "https://www.zillow.com/apartments/austin-tx/pecan-flats/5Xk9Qa/", priceText: "$1,825/mo", price: 1825, factsText: "Pecan Flats | Renovated Studios & One Bedrooms", ref: { sourceId: "5Xk9Qa", kind: "building" } },
            { title: "4100 Duval St, Austin, TX 78751", url: "https://www.zillow.com/apartments/austin-tx/mesa-court/5Xm2wT/", priceText: "$1,700+", price: 1700, factsText: "Mesa Court", ref: { sourceId: "5Xm2wT", kind: "building" } },
        ]);

        const cards = new DOMParser().parseFromString(
            `<html><body><ul><li><article data-test="property-card"><a data-test="property-card-link" href="${HOME_URL}"><address>710 E Dean Keeton St #111</address></a><span data-test="property-card-price">$1,150/mo</span><ul><li>1 bds</li><li>1 ba</li></ul></article></li></ul></body></html>`,
            "text/html",
        );
        expect(zillowPage.searchResults!(cards, "https://www.zillow.com/austin-tx/rentals/")).toEqual([
            { title: "710 E Dean Keeton St #111", url: HOME_URL, priceText: "$1,150/mo", price: 1150, factsText: "1 bds · 1 ba", ref: { sourceId: "450233440", kind: "home" } },
        ]);
    });
});

describe("zillowUrls", () => {
    it("takes a building named by its coordinates, as a search result links it, under a provisional id", () => {
        expect(zillowUrls.parse("https://www.zillow.com/b/building/30.254986,-97.79872_ll/")).toEqual({ sourceId: "ll:30.254986,-97.79872", kind: "building" });
        expect(kindOfZillowId("ll:30.254986,-97.79872")).toBe("building");
        expect(zillowUrls.listing("ll:30.254986,-97.79872")).toBeNull();
    });

    it("tells homes from buildings by the URL shape", () => {
        expect(zillowUrls.parse(HOME_URL)).toEqual({ sourceId: "450233440", kind: "home" });
        expect(zillowUrls.parse(BUILDING_URL)).toEqual({ sourceId: "CmB93F", kind: "building" });
        expect(zillowUrls.parse("https://www.zillow.com/b/710-e-dean-keeton-st-austin-tx-CvBTSB/")).toEqual({ sourceId: "CvBTSB", kind: "building" });
        expect(zillowUrls.parse("https://www.zillow.com/apartments/austin-tx/hyde-park/")).toBeNull();
        expect(zillowUrls.parse("https://www.zillow.com/portland-or/rentals/")).toBeNull();
        expect(zillowUrls.parse("https://www.apartments.com/x/450233440_zpid/")).toBeNull();
    });

    it("builds a home's page from its zpid and nothing for a building", () => {
        expect(zillowUrls.listing("450233440")).toBe("https://www.zillow.com/homedetails/450233440_zpid/");
        expect(zillowUrls.listing("CmB93F")).toBeNull();
        expect(kindOfZillowId("CmB93F")).toBe("building");
        expect(zillowUrls.canonical(`${HOME_URL}?utm=1#x`)).toBe(HOME_URL);
    });
});

describe("a Zillow home page", () => {
    const doc = fixture("zillow-listing.html");

    it("is confirmed with every probe present", () => {
        const detection = detectListing(zillowPage, doc, HOME_URL);
        expect(detection.confirmed).toBe(true);
        expect(detection.signals.map((s) => [s.name, s.present])).toEqual([
            ["hydration", true],
            ["canonical", true],
            ["metadata", true],
            ["markers", true],
        ]);
    });

    it("refuses to be another home, and refuses a building's URL", () => {
        expect(detectListing(zillowPage, doc, "https://www.zillow.com/homedetails/x/999_zpid/").confirmed).toBe(false);
        expect(detectListing(zillowPage, doc, BUILDING_URL).confirmed).toBe(false);
    });

    it("maps the property node onto core", () => {
        const capture = extractCapture(zillowPage, doc, HOME_URL)!;
        expect(capture.kind).toBe("home");
        expect(capture.core.address).toEqual({ line1: "710 E Dean Keeton St", unit: "111", city: "Austin", state: "TX", zip: "78705", text: "710 E Dean Keeton St #111, Austin, TX 78705" });
        expect(capture.core.rent.min).toBeGreaterThan(0);
        expect(capture.core.rent.min).toBe(capture.core.rent.max);
        expect(capture.core.beds).toEqual({ min: 1, max: 1 });
        expect(capture.core.propertyType).toBe("apartment");
        expect(capture.core.geo?.lat).toBeCloseTo(30.29, 1);
        expect(capture.core.photoUrls.length).toBeGreaterThan(0);
        expect(capture.core.photoUrls.every((u) => u.includes("zillowstatic.com"))).toBe(true);
        expect(capture.core.description).toMatch(/^Available August 2026/);
        expect(capture.core.contact.company).toBe("ManagePro LLC");
        const detail = capture.detail.data as ZillowDetail;
        expect(detail.homeType).toBe("APARTMENT");
        expect(detail.buildingKey).toBe("CvBTSB");
        expect(detail.buildingLotId).toBe("2796925986");
        expect(detail.buildingUrl).toBe("https://www.zillow.com/b/710-e-dean-keeton-st-austin-tx-CvBTSB/");
        expect(detail.via).toBe("hydration");
        // The raw capture is the node, not the whole payload.
        expect(typeof capture.raw).toBe("object");
        expect((capture.raw as Record<string, unknown>)["zpid"]).toBeDefined();
    });
});

describe("a Zillow building page", () => {
    const doc = fixture("zillow-building.html");

    it("is confirmed and maps floor plans and units", () => {
        expect(detectListing(zillowPage, doc, BUILDING_URL).confirmed).toBe(true);
        const capture = extractCapture(zillowPage, doc, BUILDING_URL)!;
        expect(capture.kind).toBe("building");
        expect(capture.core.name).toBe("Lenox Grand");
        expect(capture.core.address.text).toBe("13505 Burnet Rd, Austin, TX 78727");
        expect(capture.core.propertyType).toBe("apartment");
        expect(capture.core.plans.length).toBeGreaterThan(0);
        const units = capture.core.plans.flatMap((p) => p.units);
        expect(units.length).toBeGreaterThan(0);
        expect(capture.core.plans).toHaveLength(9);
        expect(units).toHaveLength(51);
        expect(units[0]).toMatchObject({ id: "2056262621", name: "Unit 04104", beds: 1, sqft: 528, rent: 1696, availableFrom: "2026-11-06", url: "https://www.zillow.com/homedetails/2056262621_zpid/" });
        expect(capture.core.rent).toEqual({ min: 1426, max: 2671 });
        expect(capture.core.rent.min).toBeLessThanOrEqual(capture.core.rent.max!);
        expect(capture.core.availableUnits).toBe(units.length);
        expect(capture.core.availableFrom).toBe("now");
        expect(capture.core.amenities).toContain("Granite Counter Tops");
        expect(capture.core.pets).toMatch(/^Cats, Large dogs, Small dogs allowed/);
        expect(capture.core.fees.map((f) => f.label)).toContain("Cats fee");
        const detail = capture.detail.data as ZillowDetail;
        expect(detail.lotId).toBe("2756532937");
        expect(detail.homeType).toBe("apartment");
    });
});

/**
 * The older `/b/<slug>-<key>/` building shape (710 E Dean Keeton St, October 2026):
 * the same payload node under the same path, with `ungroupedUnits` in place
 * of floor plans, and the page rendered as a lightbox over a search page
 * whose forty-odd cards must not be mistaken for the building.
 */
describe("a Zillow /b/ building page", () => {
    const doc = fixture("zillow-building-b.html");
    const url = "https://www.zillow.com/b/710-e-dean-keeton-st-austin-tx-CvBTSB/";

    it("is confirmed with every probe present", () => {
        const detection = detectListing(zillowPage, doc, url);
        expect(detection.confirmed).toBe(true);
        expect(detection.subject).toBe("CvBTSB");
        expect(detection.signals.map((s) => [s.name, s.present])).toEqual([
            ["hydration", true],
            ["canonical", true],
            ["metadata", true],
            ["markers", true],
        ]);
    });

    it("maps the building and every home at the lot, offering only the five for rent", () => {
        const capture = extractCapture(zillowPage, doc, url)!;
        expect(capture.kind).toBe("building");
        expect(capture.sourceId).toBe("CvBTSB");
        expect(capture.core.name).toBeNull(); // the site gives this lot no name; the card shows the address
        expect(capture.core.address.text).toBe("710 E Dean Keeton St, Austin, TX 78705");
        expect(capture.core.geo).toEqual({ lat: 30.289577, lng: -97.732005 });
        expect(capture.core.rent).toEqual({ min: 995, max: 1495 });
        expect(capture.core.availableUnits).toBe(5);
        expect(capture.core.availableFrom).toBe("now");
        const units = capture.core.plans.flatMap((p) => p.units);
        expect(units).toHaveLength(27);
        expect(units.filter((u) => u.status === "for-rent").map((u) => [u.name, u.rent, u.availableFrom])).toEqual([
            ["Unit 211", 995, "now"],
            ["Unit 111", 1150, "now"],
            ["Unit 104", 1245, "2026-09-17"],
            ["Unit 202", 1300, "now"],
            ["Unit 101", 1495, "2027-08-09"],
        ]);
        // A home for sale and the off-market ones are kept, without a rent or a date.
        const rest = units.filter((u) => u.status !== "for-rent");
        expect(rest).toHaveLength(22);
        expect(rest.filter((u) => u.status === "for-sale")).toHaveLength(1);
        expect(rest.every((u) => u.rent === null && u.availableFrom === null)).toBe(true);
        expect(capture.core.photoUrls).toHaveLength(11);
        expect((capture.detail.data as ZillowDetail).lotId).toBe("2796925986");
    });
});

describe("field helpers", () => {
    it("reads Zillow's availability and home types", () => {
        expect(availabilityFrom("0")).toBe("now");
        expect(availabilityFrom("1767225600000")).toBe("2026-01-01");
        expect(availabilityFrom("2026-11-01T00:00:00")).toBe("2026-11-01");
        expect(availabilityFrom(null)).toBeNull();
        expect(propertyTypeFrom("SINGLE_FAMILY")).toBe("house");
        expect(propertyTypeFrom(["apartment"])).toBe("apartment");
        expect(propertyTypeFrom("CONDO")).toBe("condo");
        expect(propertyTypeFrom(null)).toBeNull();
    });
});

describe("a small building with ungrouped units", () => {
    const ARBOR = {
        lotId: 1002526160,
        buildingName: "The Arbor",
        bdpUrl: "/b/the-arbor-austin-tx-5XvLGY/",
        address: { streetAddress: "1800 Lavaca St", city: "Austin", state: "TX", zipcode: "78701" },
        floorPlans: [],
        rentalUnitsSummary: { availableUnitCount: 1, unitCount: 12 },
        rentalCostsAndFees: { selectors: { beds: [{ numBeds: 1, selector: { costs: { baseRent: { amount: { min: 1650, max: null } } } } }] } },
    };

    it("makes a plan of each unit and reads the rent from the per-bedroom costs", () => {
        const node = { ...ARBOR, ungroupedUnits: [{ zpid: "2106119505", unitNumber: "Unit 101", beds: 1, baths: 1, sqft: 525, price: 1650, availableFrom: "0" }] };
        const { core } = buildingFrom(node);
        expect(core.plans.map((p) => [p.name, p.units.length])).toEqual([["Unit 101", 1]]);
        // No status on the record and a price: not known to be for rent, but offered as far as we can tell.
        expect(core.plans[0]!.units[0]).toMatchObject({ id: "2106119505", rent: 1650, availableFrom: "now", status: null, url: "https://www.zillow.com/homedetails/2106119505_zpid/" });
        expect(core.rent).toEqual({ min: 1650, max: 1650 });
        expect(core.beds).toEqual({ min: 1, max: 1 });
        // Zillow's own count, since the records did not say which units are for rent.
        expect(core.availableUnits).toBe(1);
    });

    // The list is every home record at the lot, not a rental feed. These are
    // an invented building's records, shaped like a real one's, trimmed to the keys
    // read: one unit for rent, six "OTHER" — among them a stale sale price
    // (301), stale base rents from lapsed listings (100, 201, 300) and a
    // lapsed availability date (201). Zillow's own summary says 1 of 1.
    it("keeps units that are not for rent out of the building's offer", () => {
        const node = {
            ...ARBOR,
            ungroupedUnits: [
                { listingType: "FOR_RENT", unitNumber: "Unit 101", zpid: "2106119505", price: 1650, baths: 1, beds: 1, sqft: 525, availableFrom: "0", baseRent: 1650 },
                { listingType: "OTHER", unitNumber: "Unit 301", zpid: "2112266672", price: 399400, baths: 1, beds: 1, sqft: 550, availableFrom: "0", baseRent: null },
                { listingType: "OTHER", unitNumber: "Unit 100", zpid: "2105532114", price: null, baths: 1, beds: 1, sqft: 750, availableFrom: "0", baseRent: 1850 },
                { listingType: "OTHER", unitNumber: "Unit 201", zpid: "2091639258", price: null, baths: 1, beds: 1, sqft: 500, availableFrom: "1776754800000", baseRent: 1650 },
                { listingType: "OTHER", unitNumber: "Unit 300", zpid: "2096371966", price: null, baths: 1, beds: 2, sqft: 725, availableFrom: "0", baseRent: 2200 },
                { listingType: "OTHER", unitNumber: "Unit 10", zpid: "2078695012", price: null, baths: 1, beds: 1, sqft: 405, availableFrom: "0", baseRent: null },
                { listingType: "OTHER", unitNumber: "Unit 200", zpid: "2081973017", price: null, baths: 1, beds: 1, sqft: 600, availableFrom: "0", baseRent: null },
            ],
            rentalUnitsSummary: { availableUnitCount: 1, unitCount: 1 },
        };
        const { core } = buildingFrom(node);
        const units = core.plans.flatMap((p) => p.units);
        expect(units.map((u) => [u.name, u.status, u.rent, u.availableFrom])).toEqual([
            ["Unit 101", "for-rent", 1650, "now"],
            ["Unit 301", "off-market", null, null],
            ["Unit 100", "off-market", null, null],
            ["Unit 201", "off-market", null, null],
            ["Unit 300", "off-market", null, null],
            ["Unit 10", "off-market", null, null],
            ["Unit 200", "off-market", null, null],
        ]);
        expect(core.plans.map((p) => p.availableUnits)).toEqual([1, 0, 0, 0, 0, 0, 0]);
        // Stale prices are not rent; the off-market "0" is not "now".
        expect(core.rent).toEqual({ min: 1650, max: 1650 });
        expect(core.availableUnits).toBe(1);
        expect(core.availableFrom).toBe("now");
        // Every unit still shapes the building.
        expect(core.beds).toEqual({ min: 1, max: 2 });
        expect(core.sqft).toEqual({ min: 405, max: 750 });
    });

    it("keeps a unit for sale out of the rent range but in the building", () => {
        const node = {
            ...ARBOR,
            ungroupedUnits: [
                { listingType: "FOR_RENT", unitNumber: "Unit 101", zpid: "1", price: 1650, beds: 1, baths: 1, sqft: 525, availableFrom: "0" },
                { listingType: "FOR_SALE", unitNumber: "Unit 301", zpid: "2", price: 399400, beds: 1, baths: 1, sqft: 550, availableFrom: "0" },
            ],
        };
        const { core } = buildingFrom(node);
        expect(core.plans[1]!.units[0]).toMatchObject({ status: "for-sale", rent: null, availableFrom: null });
        expect(core.rent).toEqual({ min: 1650, max: 1650 });
        expect(core.availableUnits).toBe(1);
    });

    it("reads Zillow's home statuses", () => {
        expect(unitStatusFrom("FOR_RENT")).toBe("for-rent");
        expect(unitStatusFrom("ForRent")).toBe("for-rent");
        expect(unitStatusFrom("For Rent")).toBe("for-rent");
        expect(unitStatusFrom("FOR_SALE")).toBe("for-sale");
        expect(unitStatusFrom("PENDING")).toBe("for-sale");
        expect(unitStatusFrom("RECENTLY_SOLD")).toBe("off-market");
        expect(unitStatusFrom("OTHER")).toBe("off-market");
        expect(unitStatusFrom(null)).toBeNull();
        expect(unitStatusFrom("")).toBeNull();
    });
});

describe("a home that is not for rent", () => {
    it("records the status and claims no availability", () => {
        const node = { zpid: 3, homeType: "APARTMENT", homeStatus: "OTHER", availabilityDate: "0", address: { streetAddress: "1800 Lavaca St #10", city: "Austin", state: "TX", zipcode: "78701" } };
        const { core, detail } = homeFrom(node);
        expect(detail.status).toBe("OTHER");
        expect(core.availableFrom).toBeNull();
        const rented = homeFrom({ ...node, homeStatus: "FOR_RENT" });
        expect(rented.detail.status).toBe("FOR_RENT");
        expect(rented.core.availableFrom).toBe("now");
    });
});

describe("Zillow's words on a card", () => {
    it("evens out Zillow's casing without changing what is stored", () => {
        expect(zillowWord("APARTMENT")).toBe("apartment");
        expect(zillowWord("apartment")).toBe("apartment");
        expect(zillowWord("SINGLE_FAMILY")).toBe("single family");
        expect(zillowWord(null)).toBeNull();
        expect(statusText("FOR_RENT")).toBe("for rent");
        expect(statusText("OTHER")).toBe("off market");
        expect(statusText(null)).toBeNull();
    });
});
