/// <reference types="vite/client" />
/// <reference types="@crxjs/vite-plugin/client" />

import type { DebugHandle } from "../lib/debug";
import type { DataDebugHandle } from "../lib/debug.data";

declare global {
    /**
     * Debug handle installed by lib/debug.ts into each extension context's
     * global, so DevTools can reach the logger and -- in the contexts that own
     * the database -- the database too. Nothing in the extension may depend on
     * it; it exists purely for console sessions.
     *
     * Typed as the union because which one you get depends on where you are: a
     * content script has no database on its origin and gets the narrow handle.
     */
    // eslint-disable-next-line no-var
    var __intel: DebugHandle | DataDebugHandle | undefined;

    /**
     * True in a test build (`E2E=1`, see manifest.config.ts). Defined by Vite
     * and vitest at build time; a plain `false` in a production build, which
     * lets the bundler drop what only tests use.
     */
    const __E2E__: boolean;
}

export {};
