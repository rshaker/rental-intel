import { EXAMPLE, expect, fixtureHtml, openPanel, serveExampleSite, test, waitForContentScript, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * The steps of docs/release-checks.md that a browser can run against the
 * fixtures instead of a live site: the search shortcut, the status filter
 * and the date sorts; a re-capture of a page that changed; one place saved
 * from two sites; the carousel; a backup that brings a deleted listing
 * back whole; the photo limit; and the colour scheme. What the checklist
 * shares with panel.spec.ts, settings.spec.ts and bulk.spec.ts is not
 * repeated here.
 */

test.beforeEach(async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveExampleSite(context);
});

/** Captures a fixture page through the panel, the way a click does, once the page's script is up. */
async function capture(context: BrowserContext, page: Page, panel: Page, url: string): Promise<void> {
    await page.goto(url);
    await waitForContentScript(context, page);
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
}

const titles = (panel: Page) => panel.locator(".card .title").allTextContents();

/** The listing's stored photo links. */
const photoCount = (worker: Awaited<ReturnType<typeof workerOf>>, listingId: string) =>
    worker.evaluate((id) => __intel!.db.listingPhotos.where("listingId").equals(id).count(), listingId);

test("Ctrl+F reaches the search box, the status filter narrows the list, and the date sorts order it", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    for (const n of [1, 2, 3]) {
        await seedListing(worker, { sourceId: `seed000${n}`, url: `http://localhost:5174/l/seed000${n}/`, rent: 1000 * n, core: { name: `Seed ${n}` } });
        // Distinct timestamps, so the date sorts have an order to show.
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const panel = await openPanel(context, extensionId, 3);

    // The shortcut from anywhere in the panel: here from an open card.
    await expect.poll(() => titles(panel)).toEqual(["Seed 3", "Seed 2", "Seed 1"]);
    const second = panel.locator(".card", { hasText: "Seed 2" });
    await second.locator("h2 .title").click();
    await expect(second).toHaveClass(/open/);
    await panel.keyboard.press("ControlOrMeta+f");
    await expect(panel.locator("#search")).toBeFocused();

    // A status change counts as an update, so the card moves to the top of the default sort.
    await second.locator(".status-select").selectOption("interested");
    await expect.poll(() => titles(panel)).toEqual(["Seed 2", "Seed 3", "Seed 1"]);

    // The status filter, and the count beside Filters.
    await panel.locator("#status-filter").selectOption("interested");
    await expect.poll(() => titles(panel)).toEqual(["Seed 2"]);
    await expect(panel.locator("#count")).toHaveText("1 of 3");
    await panel.locator("#status-filter").selectOption("not-interested");
    await expect(panel.locator(".card")).toHaveCount(0);
    await expect(panel.locator("#count")).toHaveText("0 of 3");
    await panel.locator("#clear-filters").click();
    await expect(panel.locator(".card")).toHaveCount(3);

    // The date sorts: newest first by nature, oldest first when flipped.
    await panel.locator("#sort-key").selectOption("createdAt");
    await expect.poll(() => titles(panel)).toEqual(["Seed 3", "Seed 2", "Seed 1"]);
    await panel.locator("#sort-dir").click();
    await expect.poll(() => titles(panel)).toEqual(["Seed 1", "Seed 2", "Seed 3"]);
    await panel.locator("#sort-key").selectOption("capturedAt");
    await expect.poll(() => titles(panel)).toEqual(["Seed 3", "Seed 2", "Seed 1"]);
    await panel.locator("#sort-key").selectOption("price");
    await expect.poll(() => titles(panel)).toEqual(["Seed 1", "Seed 2", "Seed 3"]);
});

test("a re-capture of a page that changed saves again, advances the dates and keeps the user's fields", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await capture(context, page, panel, EXAMPLE.building.url);
    await panel.bringToFront();
    const card = panel.locator(".card").first();
    await card.locator(".fold-all-open").click();
    await card.locator(".status-select").selectOption("scheduled");
    await card.locator(".notes").fill("Tour on Friday");
    await card.locator(".notes").press("Tab");

    const worker = await workerOf(context);
    const stored = () =>
        worker.evaluate(async () => {
            const [listing] = await __intel!.db.listings.toArray();
            return { updatedAt: listing!.updatedAt, capturedAt: listing!.capturedAt, rent: listing!.core.rent.min, user: listing!.user };
        });
    const before = await stored();
    expect(before.rent).toBe(1895);
    expect(before.user).toMatchObject({ status: "scheduled", notes: "Tour on Friday" });

    // The site lowers a unit's rent. A route added later wins over the fixture route, so the reload sees the new page.
    const changed = fixtureHtml(EXAMPLE.building.file).replaceAll("1,895", "1,795").replaceAll("1895", "1795");
    await context.route(EXAMPLE.building.url, (route) => route.fulfill({ contentType: "text/html", body: changed }));
    await page.reload();
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Update listing", { timeout: 10_000 });
    await expect(panel.locator("#capture-note")).toHaveText("This page differs from what is saved.");
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await expect(button).toHaveText("Re-capture");

    const after = await stored();
    expect(after.rent).toBe(1795);
    expect(after.capturedAt).toBeGreaterThan(before.capturedAt);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.user).toEqual(before.user);
    await panel.bringToFront();
    await expect(card.locator(".facts").first()).toContainText("$1,795");
    await expect(card.locator(".status-select")).toHaveValue("scheduled");
    await expect(card.locator(".notes")).toHaveValue("Tour on Friday");
});

test("one place saved from two sites: each card names the other, and the link opens it", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await capture(context, page, panel, EXAMPLE.building.url);

    // The same building as Zillow would save it: another site, another id, the same address.
    const worker = await workerOf(context);
    await seedListing(worker, {
        source: "zillow",
        sourceId: "4200juniper",
        url: "https://www.zillow.com/apartments/springfield-il/the-juniper-lofts/4200juniper/",
        kind: "building",
        rent: 1900,
        core: {
            name: EXAMPLE.building.name,
            address: { line1: "4200 Juniper Ln", unit: null, city: "Springfield", state: "IL", zip: "62704", text: "4200 Juniper Ln, Springfield, IL 62704" },
        },
    });
    await panel.bringToFront();
    await expect(panel.locator(".card")).toHaveCount(2);
    const example = panel.locator(".card", { has: panel.locator(".source-badge", { hasText: "EXA" }) });
    const zillow = panel.locator(".card", { has: panel.locator(".source-badge", { hasText: "ZIL" }) });

    // The captured card is open and names the seeded one; the jump opens the seeded card, which names the captured one back.
    await expect(example).toHaveClass(/open/);
    await expect(example.locator(".also")).toHaveText(/^Also on Zillow/);
    await expect(zillow).not.toHaveClass(/open/);
    await example.locator(".also .jump").click();
    await expect(zillow).toHaveClass(/open/);
    await expect(zillow.locator(".also")).toHaveText(/^Also on Example listings/);
    await zillow.locator(".also .jump").click();
    await expect(example).toHaveClass(/open/);
});

test("the carousel's arrows and keys step through the photos and wrap, and the mode survives a reload", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await capture(context, page, panel, EXAMPLE.building.url);
    await panel.bringToFront();
    const card = panel.locator(".card").first();
    await expect(card.locator(".thumb")).toHaveCount(3);

    await panel.locator("#photo-mode").selectOption("carousel");
    const counter = card.locator(".carousel-counter");
    await expect(card.locator(".photo img")).toBeVisible();
    await expect(counter).toHaveText("1 / 3");
    await card.locator(".carousel-next").click();
    await expect(counter).toHaveText("2 / 3");
    // The arrow keys step the open card the focus is in.
    await panel.keyboard.press("ArrowRight");
    await expect(counter).toHaveText("3 / 3");
    await card.locator(".carousel-next").click();
    await expect(counter).toHaveText("1 / 3");
    await card.locator(".carousel-prev").click();
    await expect(counter).toHaveText("3 / 3");
    await panel.keyboard.press("ArrowLeft");
    await expect(counter).toHaveText("2 / 3");

    await panel.reload();
    await expect(panel.locator("#photo-mode")).toHaveValue("carousel");
    await expect(panel.locator(".card").first().locator(".photo img")).toBeVisible();
    await panel.locator("#photo-mode").selectOption("strip");
    await expect(panel.locator(".card").first().locator(".thumb")).toHaveCount(3);
    await expect(panel.locator(".card").first().locator(".photo img")).toHaveCount(0);
});

test("a backup brings a deleted listing back with its status, note and photos, and does not duplicate the rest", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    const worker = await workerOf(context);

    // A building with photos, a status and a note; then a home beside it.
    await capture(context, page, panel, EXAMPLE.building.url);
    await panel.bringToFront();
    const building = panel.locator(".card", { hasText: EXAMPLE.building.name });
    await building.locator(".fold-all-open").click();
    await building.locator(".status-select").selectOption("interested");
    await building.locator(".notes").fill("Corner units face the park");
    await building.locator(".notes").press("Tab");
    await capture(context, page, panel, EXAMPLE.home.url);
    await panel.bringToFront();
    await expect(panel.locator(".card")).toHaveCount(2);
    const buildingId = await worker.evaluate(async (ref) => (await __intel!.db.listings.where("[source+sourceId]").equals([ref.source, ref.sourceId]).first())!.id, { source: "example", sourceId: EXAMPLE.building.id });
    await expect.poll(() => photoCount(worker, buildingId)).toBe(3);

    // Save to file, through a stand-in for the Save As dialog.
    await panel.locator('.tabs button[data-tab="data"]').click();
    await panel.evaluate(() => {
        const w = window as unknown as { showSaveFilePicker: unknown; __saved?: [string, string] };
        w.showSaveFilePicker = async (options: { suggestedName: string }) => ({
            createWritable: async () => ({
                write: async (text: string) => {
                    w.__saved = [options.suggestedName, text];
                },
                close: async () => undefined,
            }),
        });
    });
    await panel.locator("#export").click();
    await expect(panel.locator("#data-status")).toHaveText(/^Exported 2 listings and \d+ photos? /);
    const [name, text] = await panel.evaluate(() => (window as unknown as { __saved: [string, string] }).__saved);

    // Delete the building alone.
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await building.locator(".check").click();
    await panel.locator("#delete-selected").click();
    await panel.locator('#list-tools button[data-action="confirm-delete"]').click();
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.home.name]);
    expect(await photoCount(worker, buildingId)).toBe(0);

    // Open the backup: the building returns whole, and the home is not doubled.
    await panel.locator('.tabs button[data-tab="data"]').click();
    await panel.locator("#import-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(panel.locator("#data-confirm-text")).toContainText("Import 2 listings and");
    await panel.locator("#data-confirm-button").click();
    await expect(panel.locator("#data-status")).toHaveText(/^Imported 2 listings and \d+ photos?\.$/);
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await expect(panel.locator(".card")).toHaveCount(2);
    expect(await worker.evaluate(() => __intel!.db.listings.count())).toBe(2);
    await expect.poll(() => photoCount(worker, buildingId)).toBe(3);
    await building.locator("h2 .title").click();
    await expect(building).toHaveClass(/open/);
    await building.locator(".fold-all-open").click();
    await expect(building.locator(".status-select")).toHaveValue("interested");
    await expect(building.locator(".notes")).toHaveValue("Corner units face the park");
    await expect(building.locator(".thumb")).toHaveCount(3);
});

test("the photo limit applies to the next save", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="options"]').click();
    const limit = panel.locator('[data-setting="photos.limit"]');
    await expect(limit).toHaveValue("0");
    await limit.fill("2");
    await limit.press("Tab");
    await expect(panel.locator(".settings-status")).toHaveText("Saved photos per listing.");
    await panel.locator('.tabs button[data-tab="listings"]').click();

    await capture(context, page, panel, EXAMPLE.building.url);
    // "Saved." alone once the photos are in; the page stays the active tab, since the note describes the active tab.
    await expect(panel.locator("#capture-note")).toHaveText("Saved.");
    const worker = await workerOf(context);
    const [id] = await worker.evaluate(async () => (await __intel!.db.listings.toArray()).map((listing) => listing.id));
    expect(await photoCount(worker, id!)).toBe(2);
    await expect(panel.locator(".card").first().locator(".thumb")).toHaveCount(2);
});

test("the panel follows the system colour scheme without a reload", async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId, 0);
    const colours = () => panel.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
    await panel.emulateMedia({ colorScheme: "light" });
    await expect.poll(colours).toEqual(["rgb(255, 255, 255)", "rgb(31, 35, 40)"]);
    await panel.emulateMedia({ colorScheme: "dark" });
    await expect.poll(colours).toEqual(["rgb(22, 24, 29)", "rgb(230, 232, 235)"]);
    await panel.emulateMedia({ colorScheme: "light" });
    await expect.poll(colours).toEqual(["rgb(255, 255, 255)", "rgb(31, 35, 40)"]);
});
