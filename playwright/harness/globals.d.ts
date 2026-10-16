import type { ConsoleHandle } from "../../src/lib/consoleHandle";

/** The console handle as the specs' `worker.evaluate` callbacks see it: authored here, run inside the extension where src/lib/consoleHandle.ts installed it. */
declare global {
    // eslint-disable-next-line no-var
    var __intel: ConsoleHandle | undefined;
    /** Defined by Vite for src/; declared here because the handle's type reaches src/sources/index.ts. */
    const __E2E__: boolean;
    /** See src/@types/globals.d.ts; tasks/site-origin.mjs sets it in Node. */
    const __SITE_ORIGIN__: string | undefined;
}

export {};
