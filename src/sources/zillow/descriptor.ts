import type { SourceDescriptor } from "../contract.js";
import { ZILLOW_DETAIL_VERSION, type ZillowDetail } from "./types.js";
import { zillowSearch, zillowUrls } from "./urls.js";

/**
 * Zillow. A single-page app: moving between listings swaps the page's
 * hydration payload without a document load; the panel sees the URL move
 * through the tabs API and asks the page again. Photos come from a CDN of
 * their own, hence the second host.
 */
export const zillow = {
    id: "zillow",
    label: "Zillow",
    code: "ZIL",
    homepage: "https://www.zillow.com/",
    hosts: {
        pages: ["*://*.zillow.com/*"],
        photos: ["*://photos.zillowstatic.com/*"],
    },
    urls: zillowUrls,
    search: zillowSearch,
    /**
     * A building answers to its lot id as well as its URL key; a home names
     * its building by either. The building page listing the home's zpid
     * among its units is the third way, and db/relations.ts does that one.
     */
    relations(detail) {
        if (detail.version !== ZILLOW_DETAIL_VERSION) return { answersTo: [], buildingRefs: [] };
        const data = detail.data as ZillowDetail;
        return {
            answersTo: data.lotId ? [`lot:${data.lotId}`] : [],
            buildingRefs: [data.buildingKey, data.buildingLotId && `lot:${data.buildingLotId}`].filter((id): id is string => !!id),
        };
    },
    verifiedOn: "2026-09-20",
} as const satisfies SourceDescriptor;
