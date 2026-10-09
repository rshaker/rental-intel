import { describe, expect, it } from "vitest";
import { detectListing, extractCapture } from "../../content/detect";
import { apartmentsPage, placardAddress } from "./page";
import { driveSearch, firstSuggestion, searchFailure } from "./search";
import type { ApartmentsDetail } from "./types";

/**
 * The apartments.com extractor against its fixtures: trimmed captures of
 * 2026-10-08 (a community, a house, a search results page and the home
 * page) and a synthetic search page.
 */

const FIXTURES = import.meta.glob("../../../playwright/fixtures/apartments-*.html", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function fixture(name: string): Document {
    const path = Object.keys(FIXTURES).find((key) => key.endsWith(`/${name}`));
    if (!path) throw new Error(`no fixture ${name}`);
    return new DOMParser().parseFromString(FIXTURES[path]!, "text/html");
}

/** The fixture as the test window's own document, for a driver that watches the window leave. */
function install(name: string): Document {
    document.documentElement.innerHTML = fixture(name).documentElement.innerHTML;
    return document;
}

describe("apartments.com community page (captured)", () => {
    const doc = fixture("apartments-building.html");
    const url = "https://www.apartments.com/marq-uptown-austin-tx/th59pbc/";

    it("is confirmed, with the JSON-LD node claiming the URL's key", () => {
        const detection = detectListing(apartmentsPage, doc, url);
        expect(detection.confirmed).toBe(true);
        expect(detection.signals.find((s) => s.name === "jsonld")?.claim).toBe("th59pbc");
        expect(detection.signals.map((s) => [s.name, s.present])).toEqual([
            ["jsonld", true],
            ["canonical", true],
            ["og:url", true],
            ["listingid", true],
            ["markers", true],
        ]);
    });

    it("refuses a neighbourhood-shaped URL for a page that names another key", () => {
        expect(detectListing(apartmentsPage, doc, "https://www.apartments.com/austin-tx/hyde-park/").confirmed).toBe(false);
    });

    it("reads the place from the JSON-LD and the pricing grid into models and units", () => {
        const capture = extractCapture(apartmentsPage, doc, url)!;
        expect(capture.kind).toBe("building");
        expect(capture.partial).toBe(false);
        expect(capture.via).toBe("jsonld+dom");
        expect(capture.core.name).toBe("Marq Uptown");
        expect(capture.core.address).toEqual({ line1: "3320 Harmon Ave", unit: null, city: "Austin", state: "TX", zip: "78705", text: "3320 Harmon Ave, Austin, TX 78705" });
        expect(capture.core.geo).toEqual({ lat: 30.29208, lng: -97.72323 });
        expect(capture.core.propertyType).toBe("apartment");
        expect(capture.core.plans).toHaveLength(60);
        expect(capture.core.plans[0]).toMatchObject({ id: "wfmz15j", name: "0B-AMFI 80", beds: 0, baths: 1, sqft: { min: 533, max: 533 }, rent: { min: 1636, max: 1636 }, availableUnits: 1 });
        // The unit's price is the total the listing shows, not the base rent in its data attribute.
        expect(capture.core.plans[0]!.units[0]).toEqual({ id: "14kcv74", name: "241", beds: 0, baths: 1, sqft: 533, rent: 1636, availableFrom: "now", status: "for-rent", url: null });
        expect(capture.core.plans[1]!.units.map((u) => [u.name, u.rent])).toEqual([
            ["240", 1661],
            ["443", 1686],
        ]);
        const units = capture.core.plans.flatMap((p) => p.units);
        expect(units).toHaveLength(48);
        expect(capture.core.availableUnits).toBe(48);
        expect(capture.core.availableFrom).toBe("now");
        expect(capture.core.rent).toEqual({ min: 1415, max: 3566 });
        expect(capture.core.beds).toEqual({ min: 0, max: 2 });
        expect(capture.core.baths).toEqual({ min: 1, max: 2 });
        expect(capture.core.sqft).toEqual({ min: 418, max: 1527 });
        expect(capture.core.photoUrls.length).toBeGreaterThan(30);
        expect(capture.core.photoUrls.every((u) => u.startsWith("https://images1.apartments.com/"))).toBe(true);
        expect(capture.core.description).toMatch(/^Live close to class/);
        expect(capture.core.amenities).toContain("Pool");
        expect(capture.core.amenities).toContain("24-Hour Fitness Center");
        expect(capture.core.fees.slice(0, 2)).toEqual([
            { label: "Boiler Fee", amount: 16, text: "$16 / mo ($13.75/month Charged per unit.)" },
            { label: "Utility-Boiler Maintenance Fee", amount: 16.75, text: "$16.75 / mo (Charged per unit.)" },
        ]);
        expect(capture.core.pets).toMatch(/^Dogs: Dog Deposit \$300 \(Max of 2\. Charged per pet\.\), Dog Fee \$300/);
        expect(capture.core.pets).toMatch(/Restrictions: Chow Chow/);
        expect(capture.core.pets).toMatch(/ · Cats: Cat Deposit \$300/);
        expect(capture.core.contact).toEqual({ phone: "+1-737-204-6922", company: "Cws Capital Partners" });

        const detail = capture.detail.data as ApartmentsDetail;
        expect(detail.listingId).toBe("th59pbc");
        expect(detail.via).toEqual(["jsonld", "dom"]);
        expect(detail.models.slice(0, 2)).toEqual([
            { id: "wfmz15j", name: "0B-AMFI 80", rentalKeys: ["14kcv74"] },
            { id: "lecym8e", name: "0B-AMFI 130", rentalKeys: ["2tk5r19", "wh6096k"] },
        ]);
        expect(detail.rating).toBe(3.7);
        expect(detail.reviewCount).toBe(3);
        expect(detail.propertyTypeLabel).toBe("apartment community");
    });
});

/**
 * A house: the same page with no pricing grid. The price sits in the name
 * slot, the headline strip reads beds, baths, size and availability as bare
 * values, and the JSON-LD's `mainEntity` is a SingleFamilyResidence.
 */
describe("apartments.com house page (captured)", () => {
    const doc = fixture("apartments-house.html");
    const url = "https://www.apartments.com/2802-salado-st-austin-tx/gxhykqy/";

    it("is confirmed with every probe present", () => {
        const detection = detectListing(apartmentsPage, doc, url);
        expect(detection.confirmed).toBe(true);
        expect(detection.signals.every((s) => s.present)).toBe(true);
    });

    it("reads as a home, priced from the name slot and sized from the strip", () => {
        const capture = extractCapture(apartmentsPage, doc, url)!;
        expect(capture.kind).toBe("home");
        expect(capture.partial).toBe(false);
        expect(capture.core.name).toBeNull();
        expect(capture.core.address.text).toBe("2802 Salado St, Austin, TX 78705");
        expect(capture.core.geo).toEqual({ lat: 30.29382, lng: -97.74537 });
        expect(capture.core.rent).toEqual({ min: 3705, max: 3705 });
        expect(capture.core.beds).toEqual({ min: 3, max: 3 });
        expect(capture.core.baths).toEqual({ min: 2, max: 2 });
        expect(capture.core.sqft).toEqual({ min: 1142, max: 1142 });
        expect(capture.core.propertyType).toBe("house");
        expect(capture.core.plans).toEqual([]);
        expect(capture.core.availableUnits).toBeNull();
        expect(capture.core.availableFrom).toBe("2027-08-08");
        expect(capture.core.description).toMatch(/^Vintage house in West Campus/);
        expect(capture.core.amenities).toEqual(["Washer/Dryer", "Tub/Shower", "Ceiling Fans", "Heating", "Deck", "Yard"]);
        expect(capture.core.pets).toBe("Dogs Allowed · Cats Allowed");
        expect(capture.core.fees).toEqual([{ label: "Surface Lot", amount: null, text: "" }]);
        // "+1-" is the site's blank phone.
        expect(capture.core.contact).toEqual({ phone: null, company: null });
        expect(capture.core.photoUrls.length).toBeGreaterThan(10);
        expect((capture.detail.data as ApartmentsDetail).propertyTypeLabel).toBe("house");
    });
});

describe("apartments search results (captured)", () => {
    const url = "https://www.apartments.com/austin-tx-78705/";
    const doc = fixture("apartments-search-results.html");

    it("is a search page, not a listing", () => {
        expect(detectListing(apartmentsPage, doc, url).confirmed).toBe(false);
        expect(apartmentsPage.searchFailure!(doc, url)).toBeNull();
    });

    it("reads one result per placard, each with a real listing URL", () => {
        const results = apartmentsPage.searchResults!(doc, url)!;
        expect(results).toHaveLength(40);
        for (const result of results) {
            expect(result.url, result.title).toMatch(/^https:\/\/www\.apartments\.com\/[a-z0-9-]+\/[a-z0-9]+\/$/);
            expect(result.ref, result.title).not.toBeNull();
            expect(result.title).not.toMatch(/^https?:|^\$/);
        }
        expect(new Set(results.map((r) => r.url)).size).toBe(40);
    });

    it("pins the field mapping on the first placards", () => {
        const [marq, , , , studio] = apartmentsPage.searchResults!(doc, url)!;
        expect(marq).toEqual({
            title: "3320 Harmon Ave, Austin, TX 78705",
            url: "https://www.apartments.com/marq-uptown-austin-tx/th59pbc/",
            priceText: "$1,415+ – $2,578+",
            price: 1415,
            factsText: "Studio – 2 Beds · Marq Uptown",
            ref: { sourceId: "th59pbc", kind: null },
        });
        // A single bedroom count has no range.
        expect(studio).toMatchObject({ title: "305 W 35th St, Austin, TX 78705", priceText: "$895+", price: 895, factsText: "Studio · 305 Flats" });
        const named = apartmentsPage.searchResults!(doc, url)!.find((r) => r.url.includes("/sabina-austin-tx/"));
        expect(named).toMatchObject({ title: "3400 Harmon Ave, Austin, TX 78705", priceText: "$1,390+ – $1,990+", price: 1390, factsText: "Studio – 2 Beds · Sabina" });
    });

    it("heads every row with an address, never a name", () => {
        for (const result of apartmentsPage.searchResults!(doc, url)!) expect(result.title).toMatch(/, TX \d{5}$/);
    });
});

describe("apartments placard address", () => {
    it("drops the site's single-unit placeholder and keeps real units", () => {
        expect(placardAddress("6021 7th Ave NW Unit SI ID1607372P, Austin, TX 78705")).toBe("6021 7th Ave NW, Austin, TX 78705");
        expect(placardAddress("212 NW 49th St Unit SI FL2-ID1607387P, Austin, TX 78705")).toBe("212 NW 49th St, Austin, TX 78705");
        expect(placardAddress("1440 NW 60th St Unit #1, Austin, TX 78705")).toBe("1440 NW 60th St Unit #1, Austin, TX 78705");
        expect(placardAddress("1440 NW 60th St Unit 2, Austin, TX 78705")).toBe("1440 NW 60th St Unit 2, Austin, TX 78705");
        expect(placardAddress("1800 Lavaca St, Austin, TX 78701")).toBe("1800 Lavaca St, Austin, TX 78701");
        expect(placardAddress(null)).toBeNull();
    });

    it("reads the cheaper placard tier, whose title slot holds the address", () => {
        const doc = new DOMParser().parseFromString(
            `<html><body><div id="placardContainer">
                <article class="placard" data-listingid="a1b2c3d"><a class="property-link" href="https://www.apartments.com/6021-7th-ave-nw-austin-tx/a1b2c3d/"><div class="property-title">6021 7th Ave NW Unit SI ID1607372P, Austin, TX 78705</div></a><p class="property-pricing">$6,814</p><p class="property-beds">4 Beds, 4 Baths</p></article>
                <article class="placard" data-listingid="e5f6g7h"><a class="property-link" href="https://www.apartments.com/mn3618-austin-tx/e5f6g7h/" aria-label="mn3618, Austin, TX"><div class="property-title">mn3618</div><div class="property-address">3618 2nd Ave NW, Austin, TX 78705</div></a><div class="rentRollup"><div class="bedRentBox"><div class="bedTextBox">Studio</div><div class="priceTextBox">$940+</div></div></div></article>
            </div></body></html>`,
            "text/html",
        );
        expect(apartmentsPage.searchResults!(doc, "https://www.apartments.com/austin-tx-78705/")).toEqual([
            { title: "6021 7th Ave NW, Austin, TX 78705", url: "https://www.apartments.com/6021-7th-ave-nw-austin-tx/a1b2c3d/", priceText: "$6,814", price: 6814, factsText: "4 Beds, 4 Baths", ref: { sourceId: "a1b2c3d", kind: null } },
            { title: "3618 2nd Ave NW, Austin, TX 78705", url: "https://www.apartments.com/mn3618-austin-tx/e5f6g7h/", priceText: "$940+", price: 940, factsText: "Studio · mn3618", ref: { sourceId: "e5f6g7h", kind: null } },
        ]);
    });
});

describe("apartments search page (synthetic)", () => {
    const url = "https://www.apartments.com/austin-tx/";

    it("reads the placards, and the ItemList when there are none", () => {
        const doc = fixture("apartments-search.html");
        expect(apartmentsPage.searchResults!(doc, url)).toEqual([
            {
                title: "The Juniper Lofts",
                url: "https://www.apartments.com/the-juniper-lofts-austin-tx/k4m2x9z/",
                priceText: "$1,895 - $2,850",
                price: 1895,
                factsText: null,
                ref: { sourceId: "k4m2x9z", kind: null },
            },
        ]);
        for (const placard of doc.querySelectorAll("article.placard")) placard.remove();
        expect(apartmentsPage.searchResults!(doc, url)).toEqual([
            {
                title: "The Juniper Lofts",
                url: "https://www.apartments.com/the-juniper-lofts-austin-tx/k4m2x9z/",
                priceText: null,
                price: null,
                factsText: null,
                ref: { sourceId: "k4m2x9z", kind: null },
            },
        ]);
    });

    it("names the next page from the site's paging, and nothing on the last page", () => {
        const paged = (nav: string): Document => new DOMParser().parseFromString(`<html><body><div id="placardContainer"></div>${nav}</body></html>`, "text/html");
        const first = paged('<nav id="paging" class="paging"><ol><li><a class="active" data-page="1">1</a></li><li><a href="https://www.apartments.com/austin-tx/2/" data-page="2">2</a></li><li><a class="next" aria-label="Next" href="https://www.apartments.com/austin-tx/2/" data-page="2">Next</a></li></ol></nav>');
        expect(apartmentsPage.searchNextUrl!(first, url)).toBe("https://www.apartments.com/austin-tx/2/");
        const last = paged('<nav id="paging" class="paging"><ol><li><a class="previous" href="https://www.apartments.com/austin-tx/">Prev</a></li><li><a class="active" data-page="2">2</a></li></ol></nav>');
        expect(apartmentsPage.searchNextUrl!(last, "https://www.apartments.com/austin-tx/2/")).toBeNull();
        expect(apartmentsPage.searchNextUrl!(fixture("apartments-search.html"), url)).toBeNull();
        expect(apartmentsPage.searchNextUrl!(first, "https://www.apartments.com/the-juniper-austin-tx/abcdefg/")).toBeNull();
    });

    it("answers empty for an empty container, and nothing for a page that is not a search", () => {
        const empty = new DOMParser().parseFromString('<html><body><div id="placardContainer"></div></body></html>', "text/html");
        expect(apartmentsPage.searchResults!(empty, url)).toEqual([]);
        const plain = new DOMParser().parseFromString("<html><body><p>Checking your browser</p></body></html>", "text/html");
        expect(apartmentsPage.searchResults!(plain, url)).toBeNull();
        expect(apartmentsPage.searchResults!(fixture("apartments-search.html"), "https://www.apartments.com/the-juniper-austin-tx/abcdefg/")).toBeNull();
    });
});

describe("apartments home page", () => {
    const url = "https://www.apartments.com/";

    it("is neither a listing nor a search page", () => {
        const doc = fixture("apartments-home.html");
        expect(detectListing(apartmentsPage, doc, url).confirmed).toBe(false);
        expect(apartmentsPage.searchResults!(doc, url)).toBeNull();
        expect(apartmentsPage.searchFailure!(doc, url)).toBeNull();
    });

    it("drives the site's box: types, waits for the Areas suggestion, takes it, and sees the page leave", async () => {
        const doc = install("apartments-home.html");
        const box = doc.querySelector<HTMLElement>(".smart-search-input")!;
        const dropdown = doc.querySelector(".smart-search-typeahead-dropdown-container")!;
        const taken: string[] = [];
        box.addEventListener("input", () => {
            // The site answers a keystroke with its suggestions; the remembered search stays first.
            dropdown.insertAdjacentHTML(
                "beforeend",
                `<div class="smart-search-category-wrapper"><span class="smart-search-category-title">Areas</span><ul><li class="smart-search-item" data-type="geography"><span class="smart-search-match-text">${box.textContent}</span>, Austin, TX</li></ul></div>`,
            );
            dropdown.querySelector('[data-type="geography"]')!.addEventListener("click", (event) => {
                taken.push((event.target as HTMLElement).textContent!);
                // The site navigates; the window starts leaving.
                setTimeout(() => window.dispatchEvent(new Event("pagehide")), 50);
            });
        });

        expect(firstSuggestion(doc)).toBeNull(); // only Recent Searches so far
        const result = await apartmentsPage.driveSearch!(doc, url, "78701");
        expect(result?.asked).toBe(true);
        expect(result?.note).toMatch(/the box reads "78701"; took the suggestion "78701, Austin, TX"/);
        expect(box.textContent).toBe("78701");
        expect(taken).toEqual(["78701, Austin, TX"]);
    });

    it("falls back to Enter when the suggestion's click goes nowhere, and sees the page leave on that", async () => {
        const doc = install("apartments-home.html");
        const box = doc.querySelector<HTMLElement>(".smart-search-input")!;
        const dropdown = doc.querySelector(".smart-search-typeahead-dropdown-container")!;
        box.addEventListener("input", () => {
            // Drawn, but not yet wired: a click does nothing. Enter is handled.
            dropdown.insertAdjacentHTML("beforeend", `<div class="smart-search-category-wrapper"><span class="smart-search-category-title">Areas</span><ul><li class="smart-search-item" data-type="geography">78701, Austin, TX</li></ul></div>`);
        });
        box.addEventListener("keydown", (event) => {
            if ((event as KeyboardEvent).key === "Enter") setTimeout(() => window.dispatchEvent(new Event("beforeunload")), 50);
        });
        const result = await driveSearch(doc, "78701");
        expect(result?.asked).toBe(true);
        expect(result?.note).toMatch(/took the suggestion "78701, Austin, TX" at .*, sent Enter$/);
    }, 10_000);

    it("reports a page that stayed after the suggestion, Enter and the button, for another go", async () => {
        const doc = fixture("apartments-home.html");
        const box = doc.querySelector<HTMLElement>(".smart-search-input")!;
        const seen: string[] = [];
        box.addEventListener("keydown", (event) => seen.push(`keydown ${(event as KeyboardEvent).key}`));
        doc.querySelector(".smart-search-btn-search")!.addEventListener("click", () => seen.push("button"));
        const result = await driveSearch(doc, "nowhere");
        expect(result?.asked).toBe(false);
        expect(result?.note).toMatch(/no suggestion after .*, sent Enter, pressed the button; the page stayed/);
        // The typed character's key event, then the Enter, then the button.
        expect(seen).toEqual(["keydown e", "keydown Enter", "button"]);
    }, 15_000);

    it("has nothing to drive on a page without the box", async () => {
        await expect(driveSearch(fixture("apartments-search.html"), "78701")).resolves.toBeNull();
    });

    it("types again when the site empties the box, and gives up with a reason when it keeps doing so", async () => {
        const doc = fixture("apartments-home.html");
        const box = doc.querySelector<HTMLElement>(".smart-search-input")!;
        let wipes = 0;
        box.addEventListener("input", () => {
            wipes += 1;
            setTimeout(() => (box.textContent = ""), 50);
        });
        const result = await driveSearch(doc, "78701");
        expect(result?.asked).toBe(false);
        expect(result?.note).toMatch(/could not keep "78701" in the box: after typing by writing the text the site left the box reading "" \(4 attempts\)/);
        expect(wipes).toBe(4);
    }, 10_000);

    it("recognises the site's not-found page as a dead end", () => {
        const lost = new DOMParser().parseFromString("<html><head><title>404 Page Not Found</title></head><body><h1>Can we help you get somewhere else?</h1></body></html>", "text/html");
        expect(searchFailure(lost)).toMatch(/no page at that address/);
        expect(apartmentsPage.searchFailure!(lost, "https://www.apartments.com/78701/")).toMatch(/no page/);
    });
});
