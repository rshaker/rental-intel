import type { SourceDescriptor } from "../contract.js";
import { apartmentsSearch, apartmentsUrls } from "./urls.js";

/** apartments.com. One host pattern covers the pages and the photo CDN. */
export const apartments = {
    id: "apartments",
    label: "Apartments.com",
    abbreviation: "APT",
    homepage: "https://www.apartments.com/",
    hosts: {
        pages: ["*://*.apartments.com/*"],
        photos: ["*://*.apartments.com/*"],
    },
    urls: apartmentsUrls,
    search: apartmentsSearch,
    verifiedOn: "2026-10-17",
} as const satisfies SourceDescriptor;
