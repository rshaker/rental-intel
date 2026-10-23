import { SITE_BASE } from "../../src/sources/example/origin.js";

/**
 * Which file of the built site answers a request path. Shared by the Vite
 * plugin (dev server) and the Playwright harness (context.route), so the
 * two serve the same site. Query strings are the caller's to drop.
 */

export const ALL_LISTINGS_PAGE = "search/austin-tx/index.html";

export interface Resolved {
    path: string;
    status: 200 | 404;
}

/**
 * Trailing suffixes a search slug may carry when the query named the city:
 * "hyde-park-austin-tx" -> "hyde-park". The site build writes a page under
 * every suffixed slug too (site.ts), so a static host such as GitHub Pages
 * answers them without this lookup; its 404 page sends any other search
 * slug to the all-listings page, as pagePath does here.
 */
export const CITY_SUFFIXES = ["-austin-tx", "-austin-texas", "-austin", "-texas", "-tx"];

/** The request path with the site's base path removed, or null when the request is outside it. */
export function stripBase(pathname: string): string | null {
    if (SITE_BASE === "") return pathname;
    if (pathname === SITE_BASE) return "/";
    return pathname.startsWith(`${SITE_BASE}/`) ? pathname.slice(SITE_BASE.length) : null;
}

/** `pathname` is relative to the base (see stripBase). */
export function pagePath(pathname: string, has: (path: string) => boolean): Resolved {
    const path = pathname.replace(/\/+$/, "");
    if (path === "" || path === "/index.html") return { path: "index.html", status: 200 };
    const listing = /^\/l\/([a-z0-9]{4,12})$/.exec(path);
    if (listing) {
        const file = `l/${listing[1]}/index.html`;
        return has(file) ? { path: file, status: 200 } : { path: "404.html", status: 404 };
    }
    const search = /^\/search\/([a-z0-9-]+)$/.exec(path);
    if (search) {
        let slug = search[1]!;
        for (;;) {
            const file = `search/${slug}/index.html`;
            if (has(file)) return { path: file, status: 200 };
            const suffix = CITY_SUFFIXES.find((s) => slug.endsWith(s) && slug.length > s.length);
            if (!suffix) break;
            slug = slug.slice(0, -suffix.length);
        }
        return { path: ALL_LISTINGS_PAGE, status: 200 };
    }
    return { path: "404.html", status: 404 };
}

/** A photo request, "/photos/<id>/<n>.svg" relative to the base, to its file. */
export function photoPath(pathname: string): string {
    return pathname.replace(/^\/+/, "");
}

export function isPhotoPath(pathname: string): boolean {
    return pathname.startsWith("/photos/");
}

export function contentType(path: string): string {
    if (path.endsWith(".html")) return "text/html; charset=utf-8";
    if (path.endsWith(".svg")) return "image/svg+xml";
    return "text/plain; charset=utf-8";
}
