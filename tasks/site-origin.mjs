/**
 * Makes `SITE_ORIGIN` from the environment visible to src/sources/example/origin.ts
 * when it runs in Node: the manifest, the Playwright harness and the site
 * build import this first. Vite and vitest define `__SITE_ORIGIN__` themselves.
 */
globalThis.__SITE_ORIGIN__ = process.env.SITE_ORIGIN;
