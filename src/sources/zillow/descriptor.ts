import type { SourceDescriptor } from "../contract.js";
import { ZILLOW_DETAIL_VERSION, type ZillowDetail } from "./types.js";
import { zillowSearch, zillowUrls } from "./urls.js";

/** Zillow: a single-page app whose listing moves swap the hydration payload without a document load. Photos come from their own CDN host. */
export const zillow = {
    id: "zillow",
    label: "Zillow",
    abbreviation: "ZIL",
    homepage: "https://www.zillow.com/",
    hosts: {
        pages: ["*://*.zillow.com/*"],
        photos: ["*://photos.zillowstatic.com/*"],
    },
    urls: zillowUrls,
    search: zillowSearch,
    /** A building answers to its lot id as well as its URL key; a home names its building by either. */
    linkIds(detail) {
        if (detail.version !== ZILLOW_DETAIL_VERSION) return { aliases: [], buildingIds: [] };
        const data = detail.data as ZillowDetail;
        return {
            aliases: data.lotId ? [`lot:${data.lotId}`] : [],
            buildingIds: [data.buildingKey, data.buildingLotId && `lot:${data.buildingLotId}`].filter((id): id is string => !!id),
        };
    },
    verifiedOn: "2026-10-17",
} as const satisfies SourceDescriptor;
