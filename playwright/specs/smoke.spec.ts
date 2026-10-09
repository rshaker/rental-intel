import { EXAMPLE, expect, openPanel, serveExampleSite, test, waitForContentScript, workerOf } from "../harness/extension";

/** The extension loads, the worker registers the content scripts, and the capture chain runs on a fixture page. */

test.beforeEach(async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveExampleSite(context);
});

test("loads with the expected manifest and registers the example content script", async ({ context }) => {
    const worker = await workerOf(context);
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Rental Intel (test build)");
    expect(manifest.permissions).toContain("scripting");

    // Every source of the build, each on its own hosts; Zillow's main-world script beside its content script.
    await expect
        .poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => [s.id, s.matches]).sort()), { timeout: 10_000 })
        .toEqual([
            ["source:apartments", ["*://*.apartments.com/*"]],
            ["source:example", ["https://listings.example/*"]],
            ["source:zillow", ["*://*.zillow.com/*"]],
            ["source:zillow:main", ["*://*.zillow.com/*"]],
        ]);
});

test("captures a building from the example site through the panel", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);

    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();

    await expect(panel.locator(".card")).toHaveCount(1);
    const card = panel.locator(".card").first();
    await expect(card.locator(".title")).toHaveText(EXAMPLE.building.name);
    await expect(card.locator(".source-badge")).toHaveText("EXA");
    await expect(card.locator(".kind")).toContainText("Bldg");
    await expect(card.locator(".facts").first()).toContainText("$1,895 – $2,850");
    await expect(button).toHaveText("Re-capture");
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);

    // The photos follow the record; the capture row reports them until the last lands.
    const worker = await workerOf(context);
    const stored = () =>
        worker.evaluate(async () => {
            const [listing] = await __intel!.db.listings.toArray();
            const photos = await __intel!.db.listingPhotos.where("listingId").equals(listing!.id).count();
            return { kind: listing!.kind, plans: listing!.core.plans.length, units: listing!.core.plans.flatMap((p) => p.units).length, photos, source: listing!.source };
        });
    await expect.poll(stored).toEqual({ kind: "building", plans: 2, units: 3, photos: 3, source: "example" });
    await expect(panel.locator("#capture-note")).toHaveText("Saved.");
});

test("refuses a search page, and a manual capture finds nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.search.url);
    await waitForContentScript(context, page);

    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Try to capture");
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText("No listing found on this page.");
    await expect(panel.locator(".card")).toHaveCount(0);
});
