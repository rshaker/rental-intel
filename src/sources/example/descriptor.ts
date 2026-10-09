import type { SourceDescriptor } from "../contract.js";
import { exampleSearch, exampleUrls } from "./urls.js";

/** The example source: a synthetic site, listings.example, served from playwright/fixtures/ by the test harness. Test builds only, and the template for a real source. */
export const example = {
    id: "example",
    label: "Example listings",
    abbreviation: "EXA",
    homepage: "https://listings.example/",
    hosts: {
        pages: ["https://listings.example/*"],
        photos: ["https://photos.listings.example/*"],
    },
    urls: exampleUrls,
    search: exampleSearch,
    verifiedOn: "2026-09-29",
} as const satisfies SourceDescriptor;
