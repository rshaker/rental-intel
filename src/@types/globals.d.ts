/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

declare global {
    /** True in a test build (`E2E=1`, see manifest.config.ts). Defined by Vite and vitest at build time. */
    const __E2E__: boolean;
    /** The example site's root URL at build time (src/sources/example/origin.ts). Defined by Vite and vitest; set on globalThis by tasks/site-origin.mjs in Node. */
    const __SITE_ORIGIN__: string | undefined;
}

export {};
