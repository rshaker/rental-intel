/**
 * Where the example site lives. The default is the site's own dev server
 * (`npm run site:dev`); `SITE_ORIGIN` at build time moves it, base path
 * included, e.g. `https://rshaker.github.io/rental-intel`. Vite and vitest
 * define `__SITE_ORIGIN__` for the browser; tasks/site-origin.mjs sets it
 * from the environment for Node (the manifest, the harness, the site build).
 */

export const DEFAULT_SITE_ORIGIN = "http://localhost:5174";

/** The site's root URL, no trailing slash: origin plus any base path. */
export const SITE_ORIGIN = (typeof __SITE_ORIGIN__ === "string" && __SITE_ORIGIN__ !== "" ? __SITE_ORIGIN__ : DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");

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
