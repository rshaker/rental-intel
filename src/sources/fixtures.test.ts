import { describe, expect, it } from "vitest";
import { describeSignals, detectListing, extractCapture } from "../content/detect";
import type { SourcePage } from "./contract";
import { apartmentsPage } from "./apartments/page";
import { examplePage } from "./example/page";
import { zillowPage } from "./zillow/page";

/**
 * Every fixture in playwright/fixtures/, run through its source's detection
 * as the content script would run it. A fixture describes itself: its file
 * name starts with the source id, its canonical link is the URL the page
 * was served at, and whether that URL names a listing decides what the
 * verdict must be.
 *
 * For a real source the value arrives when a real capture replaces a guess
 * (see tasks/capture-page.js): then this is the test that says "the rule
 * fires on the real thing", and its failure output lists which probes
 * survived the site's latest redesign.
 *
 * A fixture named `<id>-search-results.html` is a captured search page: its
 * source must read a non-empty result list off it, every result a URL the
 * source recognises. Any other non-listing fixture must read as no list at
 * all, or as a list of recognised URLs.
 */

/** Every source's page module. Extend when a source is added. */
const PAGES: readonly SourcePage[] = [examplePage, apartmentsPage, zillowPage];

// Vite's glob import keeps this file browser-typed like the rest of src/; vitest
// resolves it at transform time, so no node:fs is needed to read the fixtures.
const FIXTURES = import.meta.glob("../../playwright/fixtures/*.html", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;

const fixtures = Object.entries(FIXTURES).flatMap(([path, html]) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const page = PAGES.find((candidate) => name.startsWith(`${candidate.descriptor.id}-`));
    if (!page) return [];
    const doc = new DOMParser().parseFromString(html, "text/html");
    const url = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? page.descriptor.homepage;
    return [{ name, page, doc, url, ref: page.descriptor.urls.parse(url) }];
});

describe.each(fixtures)("fixture $name", ({ name, page, doc, url, ref }) => {
    if (ref) {
        it(`confirms listing ${ref.sourceId} at its own URL`, () => {
            const detection = detectListing(page, doc, url);
            expect(detection, describeSignals(detection)).toMatchObject({ confirmed: true, subject: ref.sourceId });
        });

        it("extracts something worth saving", () => {
            const capture = extractCapture(page, doc, url);
            expect(capture?.sourceId).toBe(ref.sourceId);
            expect(capture?.url).toBe(page.descriptor.urls.canonical(url));
            expect(capture?.core.address.text ?? capture?.core.name).toBeTruthy();
            expect(capture?.core.rent.min ?? capture?.core.rent.max).not.toBeNull();
            expect(capture?.core.photoUrls.length).toBeGreaterThan(0);
        });
    } else {
        it("is refused, and a forced parse finds nothing", () => {
            expect(detectListing(page, doc, url).confirmed).toBe(false);
            expect(extractCapture(page, doc, url)).toBeNull();
        });

        if (page.searchResults) {
            const results = () => page.searchResults!(doc, url);
            if (name.includes("-search-results")) {
                it("lists search results the source recognises", () => {
                    const list = results();
                    expect(list?.length ?? 0).toBeGreaterThan(0);
                    for (const result of list!) {
                        expect(result.title).toBeTruthy();
                        expect(page.descriptor.urls.parse(result.url), result.url).not.toBeNull();
                    }
                });
            } else {
                it("reads no search results, or only recognised ones", () => {
                    for (const result of results() ?? []) expect(page.descriptor.urls.parse(result.url), result.url).not.toBeNull();
                });
            }
        }
    }
});

it("has at least one fixture per source", () => {
    for (const page of PAGES) {
        expect(fixtures.some((f) => f.page === page), `no fixture for ${page.descriptor.id}`).toBe(true);
    }
});
