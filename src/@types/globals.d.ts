/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

declare global {
    /** True in a test build (`E2E=1`, see manifest.config.ts). Defined by Vite and vitest at build time. */
    const __E2E__: boolean;
}

export {};
