import { ALL_SLUG, listings, NEIGHBORHOODS, slug } from "./data/index.js";
import { photoSvg } from "./photo.js";
import { homePage, listingPage, notFoundPage, searchPage } from "./render.js";
import { CITY_SUFFIXES } from "./routes.js";

/** Every file of the built site, by output path. Deterministic: the same map on every call. */
export function buildSite(): Map<string, string> {
    const files = new Map<string, string>();
    files.set("index.html", homePage(listings.length));
    files.set("404.html", notFoundPage());
    for (const l of listings) {
        files.set(`l/${l.id}/index.html`, listingPage(l));
        for (let n = 1; n <= l.photoCount; n++) files.set(`photos/${l.id}/${n}.svg`, photoSvg(l.id, n, l.kind));
    }
    const all = searchPage(ALL_SLUG, "Austin, TX", listings);
    files.set(`search/${ALL_SLUG}/index.html`, all);
    files.set("search/austin/index.html", searchPage("austin", "Austin, TX", listings));
    for (const hood of NEIGHBORHOODS) {
        const rows = listings.filter((l) => l.hood === hood);
        for (const s of searchSlugs(slug(hood))) files.set(`search/${s}/index.html`, searchPage(s, `${hood}, Austin, TX`, rows));
    }
    // "austin-texas" resolves to the all-listings page too; "austin-tx" is already it, and "austin-austin" is nobody's query.
    for (const s of CITY_SUFFIXES.filter((suffix) => !suffix.startsWith("-austin")).map((suffix) => `austin${suffix}`)) {
        if (!files.has(`search/${s}/index.html`)) files.set(`search/${s}/index.html`, searchPage(s, "Austin, TX", listings));
    }
    return files;
}

/** A neighborhood's search slug and every city-suffixed spelling of it, so each is a page of its own on a static host. */
function searchSlugs(base: string): string[] {
    return [base, ...CITY_SUFFIXES.map((suffix) => `${base}${suffix}`)];
}
