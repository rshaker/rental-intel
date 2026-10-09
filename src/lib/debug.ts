import { Logger, LogLevels, log } from "./logging";
import { hashBlob } from "./hash";
import type { LogLine } from "./messages";

/**
 * Hangs a debug handle off the context's global so DevTools can reach the
 * logger -- and, where it exists, the database -- without a rebuild.
 *
 * Each extension context (service worker, side panel, content script) has its
 * own global, so install this in each one. In a page's console, pick the right
 * context from the dropdown next to the filter box first -- a listing site's
 * console defaults to the page, not to our isolated world.
 *
 * This module is deliberately database-free. IndexedDB is per-origin, and a
 * content script's origin is the site's, not the extension's: calling a Dexie
 * query from there would silently open an *empty* second database on the
 * site's origin and answer from it. The db-backed half of the handle
 * therefore lives in debug.data.ts, which only the extension-origin contexts
 * import. That import graph is what keeps Dexie out of the content script
 * bundles; each entry point says which context it is, since it knows.
 *
 *   __intel.context                       -- which context am I in?
 *   __intel.Logger.activeLevels = ["warn", "error"]   -- quieten the console
 *   __intel.hash(blob)                    -- content hash, no database needed
 */

/** The contexts an extension entry runs in, named as the specs expect them. */
export type DebugContext = "background-worker" | "extension-page" | "isolated-world";

export interface DebugHandle {
    context: DebugContext;
    Logger: typeof Logger;
    LogLevels: typeof LogLevels;
    log: typeof log;
    hash: typeof hashBlob;
}

/** The half of the handle that is safe in any context, database or not. */
export function baseHandle(context: DebugContext): DebugHandle {
    return { context, Logger, LogLevels, log, hash: hashBlob };
}

export function setHandle(handle: DebugHandle): void {
    (globalThis as { __intel?: DebugHandle }).__intel = handle;
    if (handle.context !== "extension-page") forwardProblems(handle.context);
}

/**
 * Sends every warning and error this context logs to the extension's pages,
 * where the side panel keeps them in its activity log. An extension page
 * does not forward: the panel has the log at hand (and a message does not
 * reach its sender anyway), the options page has nothing to say. The send is
 * best effort: an orphaned content script's runtime throws, and nothing may
 * be listening.
 */
function forwardProblems(context: DebugContext): void {
    const name = context === "background-worker" ? "worker" : location.hostname.replace(/^www\./, "");
    Logger.sink = (level, text) => {
        const line: LogLine = { type: "log-line", level, context: name, text };
        try {
            void chrome.runtime.sendMessage(line).catch(() => undefined);
        } catch {
            // No runtime here, or not any more.
        }
    };
}

/** Installs the database-free handle: what a content script wants. */
export function installDebugHandle(): void {
    setHandle(baseHandle("isolated-world"));
}
