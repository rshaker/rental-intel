import type { SourceDescriptor } from "../contract.js";
import { exampleSearch, exampleUrls } from "./urls.js";

/**
 * The example source: a synthetic listing site, listings.example, that
 * exists so the core can be developed and tested without any real site in
 * the loop. Its pages are the fixtures in playwright/fixtures/example-*.html,
 * served by the Playwright harness at that host. It ships in test builds
 * only (see descriptors.ts).
 *
 * It is also the template for a real source: every file in this folder has
 * a counterpart in src/sources/apartments/ and src/sources/zillow/.
 */
export const example = {
    id: "example",
    label: "Example listings",
    code: "EXA",
    homepage: "https://listings.example/",
    hosts: {
        pages: ["https://listings.example/*"],
        photos: ["https://photos.listings.example/*"],
    },
    urls: exampleUrls,
    search: exampleSearch,
    verifiedOn: "2026-09-29",
} as const satisfies SourceDescriptor;
