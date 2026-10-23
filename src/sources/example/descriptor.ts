import type { SourceDescriptor } from "../contract.js";
import { SITE_ORIGIN, SITE_PATTERN } from "./origin.js";
import { exampleSearch, exampleUrls } from "./urls.js";

/** The example source: the invented site under site/, at SITE_ORIGIN (its published copy in a release, the dev server otherwise). In every build, so a new user can try the extension on it, and the template for a real source. */
export const example = {
    id: "example",
    label: "Example listings",
    abbreviation: "EXA",
    homepage: `${SITE_ORIGIN}/`,
    about: "An invented site of fictional Austin listings, for trying the extension without a real one. Nothing on it is for rent.",
    hosts: {
        pages: [SITE_PATTERN],
        // Photos are files of the site, under /photos/.
        photos: [SITE_PATTERN],
    },
    urls: exampleUrls,
    search: exampleSearch,
    verifiedOn: "2026-09-29",
} as const satisfies SourceDescriptor;
