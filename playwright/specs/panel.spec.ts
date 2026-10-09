import { EXAMPLE, expect, openPanel, serveExampleSite, test, waitForContentScript, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";
import type { Page } from "@playwright/test";

/**
 * The listings tab with more than one listing in it: search narrows the
 * list, the filters and the sort do what they say, an open card shows what
 * the site said and what the user wrote, user edits survive a re-capture,
 * a selection can be deleted, and a backup round-trips.
 */

test.beforeEach(async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveExampleSite(context);
});

/** Captures a fixture page through the panel, the way a click does. */
async function capture(page: Page, panel: Page, url: string): Promise<void> {
    await page.goto(url);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
}

const titles = (panel: Page) => panel.locator(".card .title").allTextContents();

test("search, filters and sort narrow and order the list", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await capture(page, panel, EXAMPLE.building.url);
    await capture(page, panel, EXAMPLE.home.url);
    await panel.bringToFront();
    await expect(panel.locator(".card")).toHaveCount(2);

    // Search: an amenity finds the building, a word from the description the home, notes too.
    const search = panel.locator("#search");
    await search.fill("laundry");
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.building.name]);
    await expect(panel.locator("#count")).toHaveText("1 of 2");
    await search.fill("fenced yard");
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.home.name]);
    await search.fill("laundry fenced");
    await expect(panel.locator(".empty")).toContainText("No listings match");
    await panel.locator(".empty button").click();
    await expect(panel.locator(".card")).toHaveCount(2);
    await expect(search).toHaveValue("");

    // A quoted phrase is one term.
    await search.fill('"no pets"');
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.home.name]);
    await search.press("Escape");
    await expect(panel.locator(".card")).toHaveCount(2);

    // Kind, site and rent filters.
    await panel.locator("#filter").selectOption("building");
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.building.name]);
    await panel.locator("#filter").selectOption("all");
    await panel.locator("#source-filter").selectOption("example");
    await expect(panel.locator(".card")).toHaveCount(2);
    await panel.locator("#price-max").fill("2000");
    // The building's cheapest unit is under the cap; the home is not.
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.building.name]);
    await panel.locator("#price-max").fill("");
    await panel.locator("#beds-min").selectOption("2");
    await expect(panel.locator(".card")).toHaveCount(2);
    await panel.locator("#beds-min").selectOption("3");
    await expect(panel.locator(".card")).toHaveCount(0);
    await panel.locator("#clear-filters").click();
    await expect(panel.locator(".card")).toHaveCount(2);

    // Reset in the title row sets no filters at all (the site filter is still
    // set from above, so it shows) and keeps the search text.
    await expect(panel.locator("#reset-filters")).toBeVisible();
    await panel.locator("#filter").selectOption("building");
    await search.fill("juniper");
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.building.name]);
    await panel.locator("#reset-filters").click();
    await expect(panel.locator("#filter")).toHaveValue("all");
    await expect(panel.locator("#source-filter")).toHaveValue("all");
    await expect(search).toHaveValue("juniper");
    await expect(panel.locator("#reset-filters")).toBeHidden();
    await search.fill("");
    await expect(panel.locator(".card")).toHaveCount(2);

    // Sort by rent: the building's $1,895 comes before the home's $2,400; flipped, after.
    await panel.locator("#sort-key").selectOption("price");
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.building.name, EXAMPLE.home.name]);
    await panel.locator("#sort-dir").click();
    await expect.poll(() => titles(panel)).toEqual([EXAMPLE.home.name, EXAMPLE.building.name]);

    // The controls survive a reload.
    await panel.reload();
    await expect(panel.locator("#sort-key")).toHaveValue("price");
    await expect(panel.locator("#sort-dir")).toHaveText("↓");
});

test("an open card shows the site's data and keeps the user's edits through a re-capture", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(EXAMPLE.building.url);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await capture(page, panel, EXAMPLE.building.url);
    await panel.bringToFront();

    // A save opens the new card; a click on its title closes it, and another opens it again.
    const card = panel.locator(".card").first();
    await expect(card).toHaveClass(/open/);
    await card.locator("h2 .title").click();
    await expect(card).not.toHaveClass(/open/);
    await card.locator("h2 .title").click();
    await expect(card).toHaveClass(/open/);
    await expect(card.locator(".photo img")).toBeVisible();
    await expect(card.locator(".carousel-counter")).toHaveText("1 / 3");

    // Every section the building has, and what is in them.
    const toggles = card.locator(".field-toggle");
    await expect(toggles).toHaveText([/Details/, /Plans/, /Units/, /Amenities/, /Fees & policies/, /Description/, /Notes/, /Links/]);
    await card.locator(".fold-all-open").click();
    await expect(card.locator(".plans tbody tr")).toHaveCount(2);
    await expect(card.locator(".units li")).toHaveCount(3);
    await expect(card.locator(".units li").first()).toContainText("Unit 101");
    await expect(card.locator(".units li").first()).toContainText("available now");
    await expect(card.locator(".amenities li")).toHaveCount(3);
    await expect(card.locator(".pets")).toHaveText("Pets: Cats and dogs welcome, $50/mo pet rent");
    await expect(card.locator(".details")).toContainText("4200 Juniper Ln, Springfield, IL 62704");
    await expect(card.locator(".details a[href*='maps?q=39.7991,-89.6443']")).toHaveCount(1);
    await expect(card.locator(".details")).toContainText("39.79910, -89.64430");
    await expect(card.locator(".details")).toContainText("Rating");
    await expect(card.locator(".details")).toContainText("4.2 / 5");

    // Status, notes and a link.
    await card.locator(".status-select").selectOption("interested");
    await card.locator(".notes").fill("Ask about the corner units");
    await card.locator(".notes").press("Tab");
    await card.locator(".link-add input").fill("example.com/tour");
    await card.locator(".link-add input").press("Enter");
    await expect(card.locator(".links li")).toHaveCount(1);
    await card.locator(".link-add input").fill("not a link");
    await card.locator(".link-add input").press("Enter");
    await expect(card.locator(".link-error")).toHaveText("That is not a web address.");

    // A re-capture reads "Re-capture" and leaves the user's fields alone.
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Re-capture");
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText("Already up to date.");
    const worker = await workerOf(context);
    const user = await worker.evaluate(async () => (await __intel!.list!())[0]!.user);
    expect(user).toEqual({ status: "interested", notes: "Ask about the corner units", links: ["https://example.com/tour"] });

    // The search finds the note.
    await panel.bringToFront();
    await panel.locator("#search").fill("corner units");
    await expect(panel.locator(".card")).toHaveCount(1);
});

test("selection, delete, export and import", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    for (const n of [1, 2, 3]) {
        await seedListing(worker, { sourceId: `seed000${n}`, url: `https://listings.example/l/seed000${n}/`, rent: 1000 * n, core: { name: `Seed ${n}` } });
    }
    const panel = await openPanel(context, extensionId, 3);

    // Select two with a shift-click range, delete them, keep the third.
    await panel.locator("#sort-key").selectOption("name");
    await panel.locator(".card").nth(0).locator(".check").click();
    await panel.locator(".card").nth(1).locator(".check").click({ modifiers: ["Shift"] });
    await expect(panel.locator("#selected-count")).toHaveText("2 entries");
    await panel.locator("#delete-selected").click();
    await expect(panel.locator("#confirm-text")).toContainText("Delete 2 listings?");
    await panel.locator('#list-tools button[data-action="confirm-delete"]').click();
    await expect.poll(() => titles(panel)).toEqual(["Seed 3"]);
    expect(await worker.evaluate(() => __intel!.db!.listings.count())).toBe(1);

    // Export, clear, import, on the Data tab: the listing comes back. The
    // Save As dialog cannot be driven, so a stand-in takes what would be
    // written; the file then goes back in through the file input.
    await panel.locator('.tabs button[data-tab="data"]').click();
    await expect(panel.locator("#data")).toBeVisible();
    await expect(panel.locator("#export-size")).toHaveText("(1 listing, 0 photos)");
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
    await expect(panel.locator("#data-status")).toHaveText(/^Exported 1 listing and 0 photos \(\d+ kB\) to rental-intel-backup-.*\.json\.$/);
    const [name, text] = await panel.evaluate(() => (window as unknown as { __saved: [string, string] }).__saved);
    expect(name).toMatch(/^rental-intel-backup-.*\.json$/);
    await panel.locator("#clear-all").click();
    await panel.locator("#data-confirm-button").click();
    await expect(panel.locator("#data-status")).toHaveText("Deleted everything.");
    await panel.locator("#import-file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(panel.locator("#data-confirm-text")).toContainText("Import 1 listing and 0 photos?");
    await panel.locator("#data-confirm-button").click();
    await expect(panel.locator("#data-status")).toHaveText("Imported 1 listing and 0 photos.");
    // Everything said is kept, in order.
    const activity = await panel.locator("#activity").inputValue();
    expect(activity.split("\n").map((line) => line.slice(10))).toEqual([
        expect.stringMatching(/^Exported 1 listing and 0 photos/),
        "Deleted everything.",
        `${name}: ready to import.`,
        "Importing…",
        "Imported 1 listing and 0 photos.",
    ]);
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await expect.poll(() => titles(panel)).toEqual(["Seed 3"]);
});

test("a backup goes through the clipboard, and the log can be copied and cleared", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    await seedListing(worker, { sourceId: "seed0001", url: "https://listings.example/l/seed0001/", rent: 1500, core: { name: "Seed 1" } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const panel = await openPanel(context, extensionId, 1);
    await panel.locator('.tabs button[data-tab="data"]').click();

    // A cancelled Save As is a line in the log, not an error.
    await panel.evaluate(() => {
        (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => {
            throw new DOMException("The user aborted a request.", "AbortError");
        };
    });
    await panel.locator("#export").click();
    await expect(panel.locator("#data-status")).toHaveText("Export cancelled.");

    // Copy, clear, paste back.
    await panel.locator("#copy-json").click();
    await expect(panel.locator("#data-status")).toHaveText(/^Copied 1 listing and 0 photos \(\d+ kB\) to the clipboard\.$/);
    const copied = await panel.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toMatchObject({ format: "rental-intel-backup" });
    await panel.locator("#clear-all").click();
    await panel.locator("#data-confirm-button").click();
    await expect(panel.locator(".card")).toHaveCount(0);
    await panel.locator("#paste-json").click();
    await expect(panel.locator("#paste-box")).toBeVisible();
    await panel.locator("#import-paste").click();
    await expect(panel.locator("#data-status")).toHaveText("Nothing pasted yet.");
    await panel.locator("#paste-box").fill(copied);
    await panel.locator("#import-paste").click();
    await expect(panel.locator("#paste-box")).toBeHidden();
    await expect(panel.locator("#data-confirm-text")).toContainText("Import 1 listing and 0 photos?");
    await panel.locator("#data-confirm-button").click();
    await expect(panel.locator("#data-status")).toHaveText("Imported 1 listing and 0 photos.");
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await expect(panel.locator(".card .title")).toHaveText(["Seed 1"]);

    // The log: copied as text, then cleared.
    await panel.locator('.tabs button[data-tab="data"]').click();
    const before = await panel.locator("#activity").inputValue();
    expect(before).toContain("Export cancelled.");
    expect(before).toContain("pasted text: ready to import.");
    await panel.locator("#copy-log").click();
    await expect(panel.locator("#data-status")).toHaveText("Log copied.");
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(before);
    await panel.locator("#clear-log").click();
    await expect(panel.locator("#activity")).toHaveValue("");
});
