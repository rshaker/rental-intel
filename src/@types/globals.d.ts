/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

declare global {
    /** The example site's root URL at build time (src/sources/example/origin.ts). Defined by Vite and vitest; set on globalThis in Node by tasks/extension-site-origin.ts and tasks/site-origin.mjs. */
    // eslint-disable-next-line no-var
    var __SITE_ORIGIN__: string | undefined;
}

export {};
