import { describe, expect, it } from "vitest";
import { describeChecks, detectListing, manualCapture } from "../content/detect";
import type { SourcePage } from "./contract";
import { apartmentsPage } from "./apartments/page";
import { examplePage } from "./example/page";
import { zillowPage } from "./zillow/page";

/**
 * Every fixture in playwright/fixtures/, run through its source's detection.
 * A fixture's file name starts with the source id and its canonical link is
 * the URL it was served at; a `<id>-search-results.html` fixture must yield
 * a result list of recognised URLs. A failure lists which checks survived
 * the site's latest redesign.
 */

/** Every source's page module. Extend when a source is added. */
const PAGES: readonly SourcePage[] = [examplePage, apartmentsPage, zillowPage];

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
            expect(detection, describeChecks(detection)).toMatchObject({ confirmed: true, listingId: ref.sourceId });
        });

        it("extracts something worth saving", () => {
            const capture = manualCapture(page, doc, url);
            expect(capture?.sourceId).toBe(ref.sourceId);
            expect(capture?.url).toBe(page.descriptor.urls.canonical(url));
            expect(capture?.core.address.text ?? capture?.core.name).toBeTruthy();
            expect(capture?.core.rent.min ?? capture?.core.rent.max).not.toBeNull();
            expect(capture?.core.photoUrls.length).toBeGreaterThan(0);
        });
    } else {
        it("is refused, and a manual capture finds nothing", () => {
            expect(detectListing(page, doc, url).confirmed).toBe(false);
            expect(manualCapture(page, doc, url)).toBeNull();
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
