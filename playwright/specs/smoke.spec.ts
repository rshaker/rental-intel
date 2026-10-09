import { EXAMPLE, expect, openPanel, serveExampleSite, test, waitForContentScript, workerOf } from "../harness/extension";

/**
 * The extension loads, the worker registers the example source's content
 * script, and the whole capture chain runs on a fixture page: content script
 * confirms, the panel offers Add listing, a click saves, a card appears.
 * The registration is the risky part -- it is a dynamic content script built
 * by CRXJS and registered with chrome.scripting -- so it is pinned first.
 */

test.beforeEach(async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveExampleSite(context);
});

test("loads with the expected manifest and registers the example content script", async ({ context }) => {
    const worker = await workerOf(context);
    const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
    expect(manifest.name).toBe("Rental Intel (test build)");
    expect(manifest.permissions).toContain("scripting");

    // Every source of the build, each on its own hosts and nothing else;
    // Zillow's page-world helper is registered beside its content script.
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

    // The save stored the record with its plans; the photos follow, and the
    // capture row reports them until the last one lands.
    const worker = await workerOf(context);
    const stored = () =>
        worker.evaluate(async () => {
            const [listing] = await __intel!.list!();
            const photos = await __intel!.photos!.of(listing!.id);
            return { kind: listing!.kind, plans: listing!.core.plans.length, units: listing!.core.plans.flatMap((p) => p.units).length, photos: photos.length, source: listing!.source };
        });
    await expect.poll(stored).toEqual({ kind: "building", plans: 2, units: 3, photos: 3, source: "example" });
    await expect(panel.locator("#capture-note")).toHaveText("Saved.");
});

test("refuses a search page, and a forced parse finds nothing", async ({ context, extensionId }) => {
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
