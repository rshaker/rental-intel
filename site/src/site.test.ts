import { describe, expect, it } from "vitest";
import { detectListing, manualCapture } from "../../src/content/detect.js";
import { examplePage } from "../../src/sources/example/page.js";
import { listings, listingUrl, PAGES_ORIGIN } from "./data/index.js";
import { buildSite } from "./site.js";

/**
 * The built site, read by the example source: every listing page confirms
 * as its own listing and captures what the data says; every other page is
 * refused; every search page lists real listing URLs. This is the guard
 * that the site keeps the shape src/sources/example/page.ts reads.
 */

const files = buildSite();

function doc(path: string): Document {
    const html = files.get(path);
    if (html === undefined) throw new Error(`no such file: ${path}`);
    return new DOMParser().parseFromString(html, "text/html");
}

describe("the built site", () => {
    it("has one page and one photo set per listing, with unique valid ids", () => {
        const ids = listings.map((l) => l.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z0-9]{4,12}$/);
        expect([...files.keys()].filter((p) => p.startsWith("l/")).length).toBe(listings.length);
        for (const l of listings) for (let n = 1; n <= l.photoCount; n++) expect(files.has(`photos/${l.id}/${n}.svg`)).toBe(true);
    });

    it.each(listings.map((l) => [l.id, l] as const))("confirms and captures %s", (_id, l) => {
        const url = listingUrl(l.id);
        const page = doc(`l/${l.id}/index.html`);
        const detection = detectListing(examplePage, page, url);
        expect(detection.confirmed, `checks: ${detection.results.map((r) => `${r.name}=${r.matched}`).join(" ")}`).toBe(true);
        expect(detection.listingId).toBe(l.id);
        const capture = manualCapture(examplePage, page, url);
        expect(capture).not.toBeNull();
        expect(capture!.kind).toBe(l.kind);
        expect(capture!.partial).toBe(false);
        expect(capture!.core.name).toBe(l.name);
        expect(capture!.core.address.city).toBe("Austin");
        expect(capture!.core.address.zip).toBe(l.zip);
        expect(capture!.core.rent.min).toBeGreaterThanOrEqual(1100);
        expect(capture!.core.rent.max).toBeLessThanOrEqual(4200);
        expect(capture!.core.photoUrls).toHaveLength(l.photoCount);
        expect(capture!.core.plans).toHaveLength(l.plans.length);
        const unitIds = capture!.core.plans.flatMap((p) => p.units.map((u) => u.id));
        expect(new Set(unitIds).size).toBe(unitIds.length);
        expect(capture!.core.propertyType).toBe(l.type);
        if (l.amenities.some((a) => /laundry|dishwasher|parking|fitness|pool/i.test(a))) expect(capture!.core.features.length).toBeGreaterThan(0);
        if (l.kind === "building") expect(capture!.detail.data).toMatchObject({ rating: l.rating });
    });

    const others = [...files.keys()].filter((p) => p.endsWith(".html") && !p.startsWith("l/"));
    it.each(others)("refuses %s as a listing", (path) => {
        const url = path === "index.html" ? `${PAGES_ORIGIN}/` : `${PAGES_ORIGIN}/${path.replace(/index\.html$/, "")}`;
        const page = doc(path);
        expect(detectListing(examplePage, page, url).confirmed).toBe(false);
        expect(manualCapture(examplePage, page, url)).toBeNull();
    });

    const searches = others.filter((p) => p.startsWith("search/"));
    it.each(searches)("lists listing URLs on %s", (path) => {
        const url = `${PAGES_ORIGIN}/${path.replace(/index\.html$/, "")}`;
        const results = examplePage.searchResults!(doc(path), url);
        expect(results).not.toBeNull();
        expect(results!.length).toBeGreaterThan(0);
        for (const r of results!) {
            expect(examplePage.descriptor.urls.parse(r.url)).not.toBeNull();
            expect(r.priceText).toMatch(/^\$/);
            expect(r.kind).not.toBeNull();
        }
    });

    it("lists every listing on the all-Austin page", () => {
        const results = examplePage.searchResults!(doc("search/austin-tx/index.html"), `${PAGES_ORIGIN}/search/austin-tx/`);
        expect(results!.map((r) => r.url).sort()).toEqual(listings.map((l) => listingUrl(l.id)).sort());
    });
});
