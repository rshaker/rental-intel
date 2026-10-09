/**
 * What tasks/trim-capture.mjs keeps of a listings.example page when it turns
 * a raw capture into a fixture, and what it reports about the payload.
 *
 * Every source has one of these next to its page module. Plain JavaScript,
 * because the trimmer runs in Node and imports it directly.
 */
export default {
    /** Script elements carrying the site's own payloads. Parsed into state.json; kept in the fixture when `payloadKeep` matches. */
    payloadSelectors: ["script#listing-data"],
    /** A payload block is kept in the fixture only when its text matches; the rest (analytics, config) goes to state.json only. */
    payloadKeep: /"plans"/,
    /** Elements whose subtree survives in the body skeleton. Everything the probes and the extractor read must be listed. */
    interesting: "[data-listing], [data-field], [data-plan], [data-unit], [data-rating], [data-search], [data-result], h1, h2, img[data-photo]",
    /** Attributes kept on surviving elements. `data-*` keeps every data attribute. */
    keepAttrs: ["id", "href", "src", "alt", "rel", "property", "content", "type", "data-*"],
    /** Hostnames whose <img> elements are kept, so the DOM photo fallback can be tested. */
    imageHosts: ["photos.listings.example"],
    /** Keys whose paths the trimmer prints, to find the fields of interest in a fresh payload. */
    keysOfInterest: /^(id|identifier|name|plans|units|rent|beds|baths|sqft|available|latitude|address)$/,
};
