import { chromium, expect, test, type BrowserContext, type Worker } from "@playwright/test";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Section 8 of docs/release-checks.md: a profile that the previous
 * release's build wrote is opened by this build. The previous release is
 * loaded from a folder, a listing is saved through its panel with a status
 * and a note, and the browser is closed. The folder's contents are
 * replaced by this build (the same path keeps the extension id, and so the
 * database), the browser is opened on the same profile and the extension
 * is reloaded, as the reload icon on chrome://extensions does. The listing
 * is still there with its edits, the schema is current, and the field the
 * new schema added is empty until a re-capture.
 *
 * The reload is not optional: Chrome starts the worker it registered for
 * the old files until the extension is reloaded, even though the manifest
 * it reports is the new one. A Web Store update reloads by itself.
 *
 * The previous release's own fixture is served at the URL its canonical
 * link names, so the spec does not depend on what that release called the
 * example site.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREVIOUS = resolve(ROOT, "work", "previous");
const OLD_DIST = resolve(PREVIOUS, "dist-e2e");
const NEW_DIST = resolve(ROOT, "dist-e2e");

type DeveloperPrivate = {
    updateProfileConfiguration(update: { inDeveloperMode: boolean }, cb: () => void): void;
    reload(id: string, options: { failQuietly: boolean }, cb: () => void): void;
};

function launch(profile: string, extension: string): Promise<BrowserContext> {
    return chromium.launchPersistentContext(profile, {
        channel: "chromium",
        args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
}

async function workerOf(context: BrowserContext): Promise<Worker> {
    return context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
}

/** What the reload icon does. Developer mode goes on first, or the reloaded extension is disabled as an unsupported developer extension. */
async function reloadExtension(context: BrowserContext, id: string): Promise<void> {
    const page = await context.newPage();
    await page.goto("chrome://extensions");
    await page.evaluate((id) => {
        const api = (chrome as unknown as { developerPrivate: DeveloperPrivate }).developerPrivate;
        return new Promise<void>((done) => api.updateProfileConfiguration({ inDeveloperMode: true }, () => api.reload(id, { failQuietly: true }, () => done())));
    }, id);
    await page.close();
}

const manifestVersion = (dist: string): string => (JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8")) as { version: string }).version;

test("a database written by the previous release is read by this build, with the user's edits intact", async () => {
    test.slow();
    for (const dist of [OLD_DIST, NEW_DIST]) {
        if (!existsSync(resolve(dist, "manifest.json"))) throw new Error(`No test build in ${dist}: run \`npm run playwright:upgrade\`, which builds both.`);
    }
    const oldVersion = manifestVersion(OLD_DIST);
    const newVersion = manifestVersion(NEW_DIST);
    expect(oldVersion).not.toBe(newVersion);

    const fixture = readFileSync(resolve(PREVIOUS, "playwright", "fixtures", "example-building.html"), "utf8");
    const url = /<link rel="canonical" href="([^"]+)"/.exec(fixture)?.[1];
    if (!url) throw new Error("The previous release's building fixture has no canonical link.");
    const serve = (context: BrowserContext) =>
        context.route(/^https?:\/\//, (route) => (route.request().url() === url ? route.fulfill({ contentType: "text/html", body: fixture }) : route.fulfill({ status: 404 })));

    const profile = test.info().outputPath("profile");
    const extension = test.info().outputPath("extension");
    rmSync(profile, { recursive: true, force: true });
    rmSync(extension, { recursive: true, force: true });
    cpSync(OLD_DIST, extension, { recursive: true });

    // The previous release saves a listing and takes a status and a note.
    let context = await launch(profile, extension);
    await serve(context);
    const oldWorker = await workerOf(context);
    const id = new URL(oldWorker.url()).host;
    expect(await oldWorker.evaluate(() => chrome.runtime.getManifest().version)).toBe(oldVersion);
    const page = await context.newPage();
    await page.goto(url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/src/panel/index.html`);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 15_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved/);
    await panel.bringToFront();
    const card = panel.locator(".card").first();
    const title = await card.locator(".title").textContent();
    await card.locator(".fold-all-open").click();
    await card.locator(".status-select").selectOption("interested");
    await card.locator(".notes").fill("Ask about the corner units");
    await card.locator(".notes").press("Tab");
    // The edits are on disk before the browser closes.
    await expect.poll(() => oldWorker.evaluate(async () => (await __intel!.db.listings.toArray())[0]?.user.notes)).toBe("Ask about the corner units");
    await context.close();

    // The same folder now holds this build; the same profile opens it, and the extension is reloaded.
    rmSync(extension, { recursive: true, force: true });
    cpSync(NEW_DIST, extension, { recursive: true });
    context = await launch(profile, extension);
    await serve(context);
    const stale = await workerOf(context);
    await reloadExtension(context, id);
    // The reloaded worker starts when something needs it, the panel here; the extension's pages are refused while the reload is under way.
    const after = await context.newPage();
    await expect.poll(() => after.goto(`chrome-extension://${id}/src/panel/index.html`).then(() => true, () => false), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => context.serviceWorkers().filter((worker) => worker !== stale).length, { timeout: 15_000 }).toBeGreaterThan(0);
    const worker = context.serviceWorkers().find((candidate) => candidate !== stale)!;
    expect(new URL(worker.url()).host, "the extension id, and with it the database, is the same").toBe(id);
    expect(await worker.evaluate(() => chrome.runtime.getManifest().version)).toBe(newVersion);

    await expect(after.locator(".card")).toHaveCount(1);
    const saved = after.locator(".card").first();
    await expect(saved.locator(".title")).toHaveText(title ?? "");
    // The panel remembers which cards were open, so the card may already be.
    if (!/\bopen\b/.test((await saved.getAttribute("class")) ?? "")) await saved.locator("h2 .title").click();
    await expect(saved).toHaveClass(/open/);
    await saved.locator(".fold-all-open").click();
    await expect(saved.locator(".status-select")).toHaveValue("interested");
    await expect(saved.locator(".notes")).toHaveValue("Ask about the corner units");

    const record = await worker.evaluate(async () => {
        const [listing] = await __intel!.db.listings.toArray();
        return { verno: __intel!.db.verno, features: listing!.core.features, readMethod: listing!.readMethod, status: listing!.user.status };
    });
    expect(record.verno).toBe(4);
    expect(record.features).toEqual([]);
    expect(typeof record.readMethod).toBe("string");
    expect(record.status).toBe("interested");
    await context.close();
});
