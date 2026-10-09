/**
 * What tasks/trim-capture.mjs keeps of an apartments.com page. Written
 * before any capture was seen: the first trim will print what the page
 * really has (ids, data-* attributes, payload keys), and this profile is
 * then tightened to it.
 */
export default {
    /** Inline JSON the site's own scripts read. Unknown yet; these are the usual suspects. */
    payloadSelectors: ['script[type="application/json"]', "script#__NEXT_DATA__", 'script[id*="state"]', 'script[id*="data"]'],
    /** Keep a payload in the fixture only when it looks like it describes the listing. */
    payloadKeep: /listing|rental|floorplan|model|unit/i,
    /** Everything the probes and the extractor read, plus the attributes a redesign moves. */
    interesting:
        "[data-listingid], #propertyName, .propertyAddressContainer, .propertyAddress, .priceBedRangeInfo, .rentInfoDetail, " +
        "#pricingView, .pricingGridItem, .unitContainer, [data-rentalkey], [data-model], .rentLabel, .modelName, .detailsTextWrapper, " +
        ".pricingColumn, .sqftColumn, .availableColumn, .dateAvailable, " +
        "#amenitiesSection, .amenityLabel, .specInfo, #descriptionSection, #feesPoliciesSection, .feespolicies, .feeName, " +
        ".petPolicyDetails, .propertyType, .phoneNumber, .reviewRating, .reviewCount, .walkScore, .transitScore, .bikeScore, .yearBuilt, .unitCount, " +
        "#placardContainer, .placardContainer, .placard, [data-url], .property-link, .property-title, .js-placardTitle, .property-pricing, .price-range, .property-rents, .property-beds, .bed-range, .property-address, " +
        ".rentRollup, .bedRentBox, .bedTextBox, .priceTextBox, " +
        "#homepage-smart-search, .smart-search-input, .smart-search-btn-search, .smart-search-typeahead-dropdown-container, .smart-search-category-title, .smart-search-item, " +
        "h1, h2, img[src*='apartments.com'], img[data-src*='apartments.com']",
    /** The home page's promotional placards (featured cities and buildings): not the page's subject, and full of place names. */
    drop: ".homepage-featured, .homepage-hub-listing, .sb-placard-container, .pmc-cards, .homepage-links, #linksSection, [id^='batBeacon'], #reviewsSection, #nearbySection, #schoolsSection, #transportationSection, #similarListingsSection",
    /** Sections whose text sits in plain wrappers below the named elements: everything with text survives inside these. */
    keepTextWithin: "#propertyHeader, #priceBedBathAreaInfoWrapper, #pricingView, #descriptionSection, #amenitiesSection, #feesSection, .propertyAddressContainer, .scores, #profileV2FeesWrapper",
    /** Classes and data attributes carry the meaning on this site, so both survive. */
    keepAttrs: ["id", "class", "href", "src", "alt", "rel", "property", "content", "type", "contenteditable", "title", "aria-label", "role", "data-*"],
    imageHosts: ["images1.apartments.com", "image.apartments.com"],
    keysOfInterest: /^(listingId|listingKey|rentalKey|propertyId|propertyName|listingName|models?|floorPlans?|units?|rent|price|beds|baths|sqft|squareFeet|latitude|longitude|address|availab\w*)$/i,
};
