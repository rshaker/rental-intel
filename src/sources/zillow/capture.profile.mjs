/**
 * What tasks/trim-capture.mjs keeps of a Zillow page. Mirrors
 * HYDRATION_SELECTORS in src/sources/zillow/page/hydration.ts.
 */
export default {
    /** Next.js emits __NEXT_DATA__ at the end of <body>; the other two are older homes of the payload. */
    payloadSelectors: ["script#__NEXT_DATA__", "script#hdpApolloPreloadedData", 'script[type="application/json"][id]'],
    /** Nav and config blobs (__PFS_TOPNAV_DATA__ and friends) match the generic selector but describe no listing or search. */
    payloadKeep: /"(zpid|lotId|listResults)"/,
    /** Every data-testid is kept, not only the ones probed: a real capture should show what a redesign renamed. data-test is the search page's property cards. */
    interesting: "[data-testid], [data-test], h1, h2, address",
    keepAttrs: ["data-testid", "data-test", "id", "href", "src", "alt", "rel", "property", "content", "type"],
    imageHosts: ["zillowstatic.com"],
    keysOfInterest:
        /^(zpid|lotId|buildingKey|buildingName|floorPlans|ungroupedUnits|price|minPrice|maxPrice|bedrooms|beds|livingArea|latitude|address|streetAddress|building|units|homeType|homeStatus|listingType|bdpUrl|listResults|mapResults|searchPageState|detailUrl|unformattedPrice|area|baths|isBuilding|buildingId)$/,
};
