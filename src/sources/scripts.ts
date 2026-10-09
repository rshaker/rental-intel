import type { SourceId } from "./descriptors";
import apartmentsScript from "./apartments/apartments.content.ts?script";
import exampleScript from "./example/example.content.ts?script";
import zillowScript from "./zillow/zillow.content.ts?script";
import zillowMain from "./zillow/zillow.main.ts?script&iife";

/**
 * Each source's scripts, as paths of built files inside the extension. The
 * `?script` import is CRXJS: it builds the file as its own entry and hands
 * back the output path, which is what chrome.scripting.registerContentScripts
 * and executeScript take.
 *
 * `content` is the source's content script (isolated world). `main`, when a
 * source has one, runs in the page's own world (`world: "MAIN"`) with no
 * extension APIs, for the one thing an isolated world cannot do: read the
 * page's JavaScript state. It is an IIFE (`?script&iife`), so it needs no
 * loader.
 *
 * Worker only. Keyed by every source id so the compiler notices a source
 * without a script.
 *
 * Why the paths come first in a tuple: CRXJS replaces each import with the
 * built path at the end of the build by matching a placeholder that must be
 * followed by `,` or `;` (its regex reads up to the next one). Inlined as an
 * object value the placeholder is followed by `}`, and the build fails.
 */
const SCRIPTS: Record<SourceId, readonly [content: string, main: string | null, id: SourceId]> = {
    apartments: [apartmentsScript, null, "apartments"],
    zillow: [zillowScript, zillowMain, "zillow"],
    example: [exampleScript, null, "example"],
};

export interface SourceScripts {
    content: string;
    main: string | null;
}

export function scriptsOf(source: SourceId): SourceScripts {
    const [content, main] = SCRIPTS[source];
    return { content, main };
}
