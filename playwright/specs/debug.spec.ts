import { EXAMPLE, expect, serveExampleSite, test, workerOf } from "../harness/extension";
import { dirname, resolve } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Pins the one invariant that makes the __intel console handle safe: only the
 * contexts that actually own the extension's IndexedDB get the db half of it.
 *
 * IndexedDB is per-origin. A content script's origin is the site's, so a Dexie
 * query from there does not read the extension's database -- it silently opens
 * an empty second database on the site's origin and answers from that. A
 * handle that offers `list()` in the isolated world is therefore worse than
 * one that does not, because it answers wrongly instead of not at all.
 *
 * Two independent guards, because they fail in different ways:
 *   - the bundle test catches an import that drags db/ back into a source's
 *     content script, which is the regression a refactor would actually cause;
 *   - the runtime tests catch a context predicate that stops matching reality,
 *     which is what a Chrome change would cause.
 */

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist");

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

/** Reads a handle's shape from one execution context. */
const HANDLE_SHAPE = "JSON.stringify({ context: globalThis.__intel?.context ?? null, keys: Object.keys(globalThis.__intel ?? {}).sort() })";

interface HandleShape {
    context: string | null;
    keys: string[];
}

async function handleIn(target: Page | { evaluate: Page["evaluate"] }): Promise<HandleShape> {
    return JSON.parse(await target.evaluate(HANDLE_SHAPE as never)) as HandleShape;
}

/**
 * The content script's handle, read out of its isolated world.
 *
 * page.evaluate() cannot see it -- that runs in the page's main world, which is
 * the whole point of the isolation. CDP can, by naming the execution context
 * Chrome labels with the extension's name.
 */
async function handleInIsolatedWorld(context: BrowserContext, page: Page): Promise<HandleShape> {
    const cdp = await context.newCDPSession(page);
    const worlds: { id: number; name: string }[] = [];
    cdp.on("Runtime.executionContextCreated", (event) => {
        worlds.push({ id: event.context.id, name: event.context.name });
    });
    await cdp.send("Runtime.enable");

    await page.goto(EXAMPLE.building.url);
    await expect.poll(() => worlds.some((w) => w.name === "Rental Intel (test build)"), { timeout: 10_000 }).toBe(true);
    const world = worlds.find((w) => w.name === "Rental Intel (test build)");

    const read = async (): Promise<HandleShape> => {
        const result = await cdp.send("Runtime.evaluate", { expression: HANDLE_SHAPE, contextId: world?.id });
        return JSON.parse(result.result.value as string) as HandleShape;
    };

    // The world exists as soon as the loader stub runs, but the stub then
    // import()s the real module, and only that installs the handle. So wait
    // for it rather than reading once and racing the import.
    await expect.poll(() => read().then((shape) => shape.context), { timeout: 10_000 }).not.toBeNull();
    return read();
}

test("no content script bundle carries the database layer", () => {
    // Every source's content script is a dynamic script: a loader stub that
    // imports the real chunk. Both are in assets/ under the entry's name,
    // <id>.content.ts.
    const loaders = readdirSync(resolve(DIST, "assets")).filter((name) => /\.content\.ts-loader-.*\.js$/.test(name));
    expect(loaders.length, "the build emitted at least one content script loader").toBeGreaterThan(0);

    for (const loader of loaders) {
        const chunks = chunkClosure(`assets/${loader}`);
        // Sanity: the walk found the real chunk, not just the loader stub.
        expect(chunks.length, loader).toBeGreaterThan(1);
        const carryingDexie = chunks.filter((chunk) => /dexie/i.test(readFileSync(resolve(DIST, chunk), "utf8")));
        expect(carryingDexie, `Dexie must not be reachable from ${loader}`).toEqual([]);
    }
});

test("the service worker gets the database half", async ({ context }) => {
    const worker = await workerOf(context);
    const handle = await handleIn(worker);

    expect(handle.context).toBe("background-worker");
    expect(handle.keys).toContain("db");
    expect(handle.keys).toContain("list");
    expect(handle.keys).toContain("sources");
});

test("the side panel gets the database half", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    // String form: the specs are a separate TS program from src/, so the
    // globals.d.ts declaration of __intel is not in scope here.
    await page.waitForFunction("globalThis.__intel !== undefined");
    const handle = await handleIn(page);

    expect(handle.context).toBe("extension-page");
    expect(handle.keys).toContain("db");
    expect(handle.keys).toContain("list");
});

test("a content script gets a handle with no database on it", async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveExampleSite(context);

    const page = await context.newPage();
    const handle = await handleInIsolatedWorld(context, page);

    expect(handle.context).toBe("isolated-world");
    expect(handle.keys).toEqual(["LogLevels", "Logger", "context", "hash", "log"]);

    // The page's own world never sees the handle at all -- if this ever fails,
    // the content script has leaked out of its isolated world.
    expect(await handleIn(page)).toEqual({ context: null, keys: [] });
});
