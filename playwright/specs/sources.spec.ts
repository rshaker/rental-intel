import { expect, fixtureHtml, openPanel, test, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";

/**
 * The Sources tab: every source in the build is listed with its state and
 * its count. In the test build the hosts are required, so the switch can
 * only report that Chrome kept them -- the grant-and-register path itself
 * is covered by smoke.spec.ts, which finds the script registered on start.
 */

test("the Sources tab lists the example source as enabled, with its count, and explains a refused disable", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    await seedListing(worker, { sourceId: "seed0001", url: "http://localhost:5174/l/seed0001/", rent: 1000 });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    await page.locator('.tabs button[data-tab="sources"]').click();
    await expect(page.locator("#sources")).toBeVisible();
    await expect(page.locator("#root")).toBeHidden();

    const row = page.locator('#sources .source-row[data-source="example"]');
    await expect(row).toHaveClass(/enabled/);
    await expect(row.locator(".source-name")).toHaveText("Example listings");
    await expect(row.locator(".source-home")).toHaveAttribute("href", "http://localhost:5174/");
    await expect(row.locator(".source-facts")).toContainText("Enabled · 1 listing saved");
    await expect(row.locator('button[data-action="toggle"]')).toHaveText("Disable");

    await row.locator('button[data-action="toggle"]').click();
    await expect(page.locator('#sources .source-row[data-source="example"] .source-note')).toContainText("required by this build");
    await expect(page.locator('#sources .source-row[data-source="example"]')).toHaveClass(/enabled/);

    // Still registered: a refused disable changes nothing in the worker.
    const registered = await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort());
    expect(registered).toEqual(["source:apartments", "source:example", "source:zillow", "source:zillow:main"]);

    // The tab survives a reload.
    await page.reload();
    await expect(page.locator("#sources")).toBeVisible();
});

/**
 * The capture row's offer. Chrome's prompt cannot be clicked through, and
 * this build's hosts are required anyway, so the panel page's own view of
 * the grant is stubbed: apartments.com reads as off until `request` is
 * called, and as off again after `remove`. The worker keeps its real view,
 * so the site's content script is in the tab and answers once the panel
 * asks.
 */
const LISTING_URL = "https://www.apartments.com/marq-uptown-austin-tx/th59pbc/";

test("a supported site that is off is offered on the Listings tab, and the label follows the grant without a reopen", async ({ context, extensionId }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    const listing = fixtureHtml("apartments-building.html");
    await context.route("https://www.apartments.com/**", (route) => route.fulfill({ contentType: "text/html", body: listing }));
    await context.route("https://images1.apartments.com/**", (route) => route.fulfill({ status: 404 }));
    await context.addInitScript(() => {
        if (!("chrome" in globalThis) || !chrome.permissions) return;
        let granted = false;
        const isApartments = (p: chrome.permissions.Permissions): boolean => (p.origins ?? []).some((origin) => origin.includes("apartments.com"));
        const contains = chrome.permissions.contains.bind(chrome.permissions);
        chrome.permissions.contains = async (p: chrome.permissions.Permissions) => (isApartments(p) && !granted ? false : contains(p));
        chrome.permissions.request = async (p: chrome.permissions.Permissions) => {
            if (isApartments(p)) granted = true;
            return true;
        };
        chrome.permissions.remove = async (p: chrome.permissions.Permissions) => {
            if (isApartments(p)) granted = false;
            return true;
        };
    });

    const page = await context.newPage();
    await page.goto(LISTING_URL);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    const note = panel.locator("#capture-note");
    const offer = panel.locator("#enable-source");
    await expect(button).toHaveText("Try to capture");
    await expect(note).toHaveText("Apartments.com is supported but not enabled.");
    await expect(offer).toBeVisible();

    // The offer asks Chrome; the row then reads the page without the panel being reopened.
    await offer.click();
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await expect(offer).toBeHidden();
    await expect(note).toHaveText("");

    // Disabled again on the Sources tab: the offer is back at once.
    await panel.locator('.tabs button[data-tab="sources"]').click();
    const row = panel.locator('#sources .source-row[data-source="apartments"]');
    await expect(row.locator('button[data-action="toggle"]')).toHaveText("Disable");
    await row.locator('button[data-action="toggle"]').click();
    await expect(row.locator('button[data-action="toggle"]')).toHaveText("Enable");
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await expect(button).toHaveText("Try to capture");
    await expect(offer).toBeVisible();
});
