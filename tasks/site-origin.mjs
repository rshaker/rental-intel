/**
 * Makes `SITE_ORIGIN` from the environment visible to src/sources/example/origin.ts
 * when it runs in Node: the Playwright harness and the site build import this
 * first, and with nothing in the environment keep the dev server. The manifest
 * imports extension-site-origin.ts instead. Vite and vitest define
 * `__SITE_ORIGIN__` themselves.
 */
globalThis.__SITE_ORIGIN__ = process.env.SITE_ORIGIN;
