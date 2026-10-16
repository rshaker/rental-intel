import { ALL_SLUG, listings, NEIGHBORHOODS, slug } from "./data/index.js";
import { photoSvg } from "./photo.js";
import { homePage, listingPage, notFoundPage, searchPage } from "./render.js";

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
        files.set(`search/${slug(hood)}/index.html`, searchPage(slug(hood), `${hood}, Austin, TX`, rows));
    }
    return files;
}
