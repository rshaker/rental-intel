/**
 * The two places the example site lives. The dev server (`npm run site:dev`)
 * is the default everywhere the site is served from files: the test build,
 * vitest, the Playwright harness and the site's own build. The published
 * copy, beside the documentation, is the default for the release build, so
 * an installed extension can read from it with no local server. The
 * `SITE_ORIGIN` environment variable overrides both, base path included.
 * Kept apart from origin.ts so the manifest can choose before origin.ts reads
 * the choice.
 */

export const DEV_SITE_ORIGIN = "http://localhost:5174";

export const PUBLISHED_SITE_ORIGIN = "https://rshaker.github.io/rental-intel/site";

/** The site an extension build reads from: the environment's, else the published site for a release and the dev server for the test build (`E2E=1`). */
export function extensionSiteOrigin(env: { SITE_ORIGIN?: string | undefined; E2E?: string | undefined }): string {
    return env.SITE_ORIGIN || (env.E2E === "1" ? DEV_SITE_ORIGIN : PUBLISHED_SITE_ORIGIN);
}
