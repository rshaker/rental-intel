import type { ConsoleHandle } from "../../src/lib/consoleHandle";

/** The console handle as the specs' `worker.evaluate` callbacks see it: authored here, run inside the extension where src/lib/consoleHandle.ts installed it. */
declare global {
    // eslint-disable-next-line no-var
    var __intel: ConsoleHandle | undefined;
    /** See src/@types/globals.d.ts; tasks/site-origin.mjs sets it in Node. */
    // eslint-disable-next-line no-var
    var __SITE_ORIGIN__: string | undefined;
}

export {};
