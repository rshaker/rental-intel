import type { SourceDescriptor } from "../contract.js";
import { apartmentsSearch, apartmentsUrls } from "./urls.js";

/**
 * apartments.com (CoStar). Listing pages are full document loads. One host
 * pattern covers the pages and the photo CDN (images1.apartments.com), so
 * enabling the source is one grant.
 */
export const apartments = {
    id: "apartments",
    label: "Apartments.com",
    code: "APT",
    homepage: "https://www.apartments.com/",
    hosts: {
        pages: ["*://*.apartments.com/*"],
        photos: ["*://*.apartments.com/*"],
    },
    urls: apartmentsUrls,
    search: apartmentsSearch,
    verifiedOn: "2026-10-08",
} as const satisfies SourceDescriptor;
