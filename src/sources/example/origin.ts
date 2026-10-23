import { DEV_SITE_ORIGIN } from "./siteOrigins.js";

/**
 * Where the example site lives, settled at build time (siteOrigins.ts): the
 * published copy for a release build, the dev server for everything else,
 * and `SITE_ORIGIN` in the environment over both, base path included. Vite
 * and vitest define `__SITE_ORIGIN__` for the browser; in Node,
 * tasks/extension-site-origin.ts sets it for the manifest and
 * tasks/site-origin.mjs for the harness and the site build.
 */

/** The site's root URL, no trailing slash: origin plus any base path. */
export const SITE_ORIGIN = (typeof __SITE_ORIGIN__ === "string" && __SITE_ORIGIN__ !== "" ? __SITE_ORIGIN__ : DEV_SITE_ORIGIN).replace(/\/+$/, "");

const parsed = new URL(SITE_ORIGIN);

export const SITE_HOSTNAME = parsed.hostname;

/** "" or "/rental-intel": the path under which the site is served. */
export const SITE_BASE = parsed.pathname.replace(/\/+$/, "");

/** The Chrome match pattern for the site. Any scheme, since a pasted URL may have had its scheme guessed, and no port, so localhost matches on any port. */
export const SITE_PATTERN = `*://${parsed.hostname}${SITE_BASE}/*`;

/** The path of a site URL relative to the base, or null when the URL is not on the site. "/l/abc/" for "<root>/l/abc/". */
export function sitePath(url: string): string | null {
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return null;
    }
    // Either scheme: a pasted URL may have had its scheme guessed (panel/bulk/urlList.ts).
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.hostname !== parsed.hostname) return null;
    if (u.pathname === SITE_BASE) return "/";
    if (!u.pathname.startsWith(`${SITE_BASE}/`)) return null;
    return u.pathname.slice(SITE_BASE.length);
}
