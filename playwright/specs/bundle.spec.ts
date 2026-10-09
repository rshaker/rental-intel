import { test, expect } from "../harness/extension";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * No content script bundle may reach the database layer. IndexedDB is per
 * origin: a Dexie query from a content script would open an empty second
 * database on the site's origin and answer from it. The build is what
 * enforces the split, so the built chunks are what is checked.
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist-e2e");

/** Every chunk reachable from a built entry, following static and getURL imports. */
function chunkClosure(entry: string): string[] {
    const seen = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
        const file = queue.shift();
        if (file === undefined || seen.has(file)) continue;
        seen.add(file);
        const source = readFileSync(resolve(DIST, file), "utf8");
        for (const [, spec] of source.matchAll(/["'](?:\.\/|assets\/)([\w.-]+\.js)["']/g)) {
            queue.push(`assets/${spec}`);
        }
    }
    return [...seen];
}

test("no content script bundle carries the database layer", () => {
    // Every source's content script is a loader stub that imports the real chunk; both are in assets/ under the entry's name.
    const loaders = readdirSync(resolve(DIST, "assets")).filter((name) => /\.content\.ts-loader-.*\.js$/.test(name));
    expect(loaders.length, "the build emitted at least one content script loader").toBeGreaterThan(0);

    for (const loader of loaders) {
        const chunks = chunkClosure(`assets/${loader}`);
        expect(chunks.length, loader).toBeGreaterThan(1);
        const carryingDexie = chunks.filter((chunk) => /dexie/i.test(readFileSync(resolve(DIST, chunk), "utf8")));
        expect(carryingDexie, `Dexie must not be reachable from ${loader}`).toEqual([]);
    }
});
