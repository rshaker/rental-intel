import { expect, test, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";

/**
 * The Sources tab: every source in the build is listed with its state and
 * its count. In the test build the hosts are required, so the switch can
 * only report that Chrome kept them -- the grant-and-register path itself
 * is covered by smoke.spec.ts, which finds the script registered on start.
 */

test("the Sources tab lists the example source as enabled, with its count, and explains a refused disable", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    await seedListing(worker, { sourceId: "seed0001", url: "https://listings.example/l/seed0001/", rent: 1000 });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    await page.locator('.tabs button[data-tab="sources"]').click();
    await expect(page.locator("#sources")).toBeVisible();
    await expect(page.locator("#root")).toBeHidden();

    const row = page.locator('#sources .source-row[data-source="example"]');
    await expect(row).toHaveClass(/enabled/);
    await expect(row.locator(".source-name")).toHaveText("Example listings");
    await expect(row.locator(".source-home")).toHaveAttribute("href", "https://listings.example/");
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
