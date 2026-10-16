import "../../tasks/site-origin.mjs";
import type { BrowserContext } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_ORIGIN } from "../../src/sources/example/origin";
import { contentType, isPhotoPath, pagePath, photoPath, stripBase } from "../../site/src/routes";

/**
 * The example site from its build (site/dist/, `npm run site:build`):
 * every request to SITE_ORIGIN is answered from a file there, so the
 * extension sees the real pages at their real URLs without a server. The
 * browser suite keeps its three fixtures (serveExampleSite); this is for
 * the store artwork and anything else that wants a whole city.
 */

export const SITE_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "site", "dist");

export async function serveBuiltSite(context: BrowserContext): Promise<void> {
    if (!existsSync(resolve(SITE_DIST, "index.html"))) {
        throw new Error(`The built site is missing: run \`npm run site:build\` first (looked in ${SITE_DIST}).`);
    }
    const has = (path: string) => existsSync(resolve(SITE_DIST, path));
    await context.route(`${SITE_ORIGIN}/**`, (route) => {
        const pathname = stripBase(new URL(route.request().url()).pathname);
        if (pathname === null) return route.fulfill({ status: 404 });
        if (isPhotoPath(pathname)) {
            const path = photoPath(pathname);
            return has(path) ? route.fulfill({ contentType: contentType(path), body: readFileSync(resolve(SITE_DIST, path)) }) : route.fulfill({ status: 404 });
        }
        const { path, status } = pagePath(pathname, has);
        return route.fulfill({ status, contentType: contentType(path), body: readFileSync(resolve(SITE_DIST, path), "utf8") });
    });
}
