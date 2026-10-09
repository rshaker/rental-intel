import { test as base, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist-e2e");
export const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/**
 * Fixtures that load the built extension into a persistent context -- the only
 * kind of context Chrome will accept `--load-extension` for -- and expose the
 * generated extension id, which every chrome-extension:// URL needs.
 *
 * The build must be the E2E one (`npm run build:e2e`): it carries the example
 * source and declares every source's hosts as required, so no permission
 * prompt stands between a test and a content script.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
    context: async ({ }, use) => {
        const context = await chromium.launchPersistentContext("", {
            channel: "chromium",
            args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
        });
        await use(context);
        await context.close();
    },

    extensionId: async ({ context }, use) => {
        // The service worker registers shortly after launch; its URL carries the id.
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
        await use(new URL(worker.url()).host);
    },
});

export const expect = test.expect;

export async function workerOf(context: BrowserContext): Promise<Worker> {
    return context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
}

/**
 * The side panel as a page of its own, with `expectedCards` cards drawn. Note
 * that opening it makes it the active tab: a test that wants the panel to talk
 * about a listing brings that listing's page to the front afterwards.
 */
export async function openPanel(context: BrowserContext, extensionId: string, expectedCards: number): Promise<Page> {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    await expect(page.locator(".card")).toHaveCount(expectedCards);
    return page;
}

// ---------------------------------------------------------------------------
// The example site, served from fixtures. Every request to listings.example
// is answered locally, so no test ever touches the network.
// ---------------------------------------------------------------------------

export const EXAMPLE = {
    building: { url: "https://listings.example/l/juniper01/", id: "juniper01", name: "The Juniper Lofts", file: "example-building.html" },
    home: { url: "https://listings.example/l/pecan00b/", id: "pecan00b", name: "118 Pecan St Unit B", address: "118 Pecan St Unit B, Springfield, IL 62704", file: "example-home.html" },
    search: { url: "https://listings.example/search/springfield/", file: "example-search.html" },
} as const;

/** A 1x1 PNG, for the photo CDN. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export function fixtureHtml(file: string): string {
    return readFileSync(resolve(FIXTURES, file), "utf8");
}

/** Which fixture stands in for a listings.example URL. */
export function fixtureFor(url: string): string {
    if (url.includes(`/l/${EXAMPLE.building.id}`)) return fixtureHtml(EXAMPLE.building.file);
    if (url.includes(`/l/${EXAMPLE.home.id}`)) return fixtureHtml(EXAMPLE.home.file);
    return fixtureHtml(EXAMPLE.search.file);
}

export async function serveExampleSite(context: BrowserContext): Promise<void> {
    await context.route("https://listings.example/**", (route) =>
        route.fulfill({ contentType: "text/html", body: fixtureFor(route.request().url()) }),
    );
    await context.route("https://photos.listings.example/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
}

/** Content scripts run at document_idle, so they are not up the instant goto resolves. */
export async function waitForContentScript(context: BrowserContext, page: Page): Promise<void> {
    const worker = await workerOf(context);
    await page.bringToFront();
    await expect
        .poll(
            () =>
                worker.evaluate(async () => {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab?.id === undefined) return false;
                    const response = await chrome.tabs.sendMessage(tab.id, { type: "status" }).catch(() => undefined);
                    return response !== undefined;
                }),
            { timeout: 10_000 },
        )
        .toBe(true);
}
