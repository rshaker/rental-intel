import type { DataDebugHandle } from "../../src/lib/debug.data";

/**
 * The console handle, as the specs' `worker.evaluate` and `page.evaluate`
 * callbacks see it. Those callbacks are authored here but run inside the
 * extension, where src/lib/debug.data.ts installed the handle; this
 * declaration only gives the callbacks its type. The specs are a separate
 * TypeScript program from src/, so src/@types/globals.d.ts is not in scope.
 */
declare global {
    // eslint-disable-next-line no-var
    var __intel: DataDebugHandle | undefined;
    /** Defined by Vite for src/; declared here only because the handle's type reaches src/sources/index.ts. */
    const __E2E__: boolean;
}

export {};
