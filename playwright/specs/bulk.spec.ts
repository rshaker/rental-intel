import { EXAMPLE, expect, fixtureHtml, test, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";
import { writeFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

/**
 * The Load URLs dialog end to end: a pasted list plus a chosen file are
 * checked, the plan lands in the log, the active tab walks the list, each
 * confirmed page is saved through the worker, a page that never confirms
 * waits on the person and is skipped, and Cancel ends a run. The parser is
 * pinned by src/panel/bulk/urlList.test.ts.
 *
 * The dead URL is served the search fixture: a page that looks like a
 * listing by URL alone. The "other" URL is served the home fixture: a page
 * that confirms a different listing than the one asked for.
 */

const HOME_URL = EXAMPLE.home.url;
const SAVED_URL = EXAMPLE.building.url;
const DEAD_URL = "https://listings.example/l/dead0001/";
const OTHER_URL = "https://listings.example/l/other001/";

const action = (page: Page, name: string): Locator => page.locator(`#load-buttons button[data-action="${name}"]`);
const logLines = (page: Page) => page.locator("#load-log li").allTextContents();

test("the Load URLs dialog checks a pasted and chosen list, runs it, waits on unconfirmed pages, and reports failures", async ({ context, extensionId }) => {
    // Two pages below wait out the full detection budget on purpose.
    test.slow();
    const worker = await workerOf(context);
    const home = fixtureHtml(EXAMPLE.home.file);
    const search = fixtureHtml(EXAMPLE.search.file);
    await context.route("https://listings.example/**", async (route) => {
        const url = route.request().url();
        // The mismatched page answers slowly, so the page being left is still alive after the loader has moved on.
        if (url.includes("other001")) await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({ contentType: "text/html", body: url.includes(EXAMPLE.home.id) || url.includes("other001") ? home : search });
    });
    await context.route("https://photos.listings.example/**", (route) => route.fulfill({ status: 404 }));

    // One listing is already in the database, so its line must be skipped without ever being loaded.
    await seedListing(worker, { sourceId: EXAMPLE.building.id, url: SAVED_URL, kind: "building", core: { name: EXAMPLE.building.name } });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    await expect(page.locator(".card")).toHaveCount(1);

    // Open, from the Data tab: a modal with the textarea, and no log yet.
    const dialog = page.locator("#load-dialog");
    await page.locator('.tabs button[data-tab="data"]').click();
    await page.locator("#load-urls").click();
    await expect(dialog).toBeVisible();
    await expect(page.locator("#load-text")).toBeFocused();
    await expect(page.locator("#load-log")).toBeHidden();
    await expect(action(page, "start")).toBeHidden();

    // Paste some, choose a file for the rest: the file appends to the paste.
    await page.locator("#load-text").fill(`# shortlist\n\n${HOME_URL}\n${HOME_URL}?utm_source=share`);
    const list = test.info().outputPath("shortlist.txt");
    writeFileSync(list, [SAVED_URL, OTHER_URL, DEAD_URL, "https://listings.example/search/portland/", "not a url"].join("\n"));
    await page.locator("#load-file").setInputFiles(list);
    await expect(page.locator("#load-text")).toHaveValue(`# shortlist\n\n${HOME_URL}\n${HOME_URL}?utm_source=share\n${SAVED_URL}\n${OTHER_URL}\n${DEAD_URL}\nhttps://listings.example/search/portland/\nnot a url`);

    // Check: the plan goes in the log, and nothing has loaded yet.
    await action(page, "check").click();
    await expect(action(page, "start")).toBeVisible();
    await expect(page.locator("#load-text")).toBeHidden();
    expect((await logLines(page)).slice(1)).toEqual([
        "Not a listing URL: https://listings.example/search/portland/",
        "Not a listing URL: not a url",
        "1 duplicate line ignored.",
        "1 listing already saved, skipped.",
        "Ready to load 3 listings (3 from example) in the active tab, one at a time.",
    ]);
    expect(context.pages().filter((p) => p.url().includes("listings.example"))).toHaveLength(0);

    // Back keeps the text; Check again gets to the same place.
    await action(page, "back").click();
    await expect(page.locator("#load-text")).toHaveValue(/shortlist/);
    await action(page, "check").click();
    await expect(action(page, "start")).toBeVisible();

    // Start: the home is saved. Escape does not close a run.
    await action(page, "start").click();
    await expect(action(page, "cancel")).toBeVisible();
    await expect(page.locator("#load-log")).toContainText(`saved: ${EXAMPLE.home.name}`, { timeout: 20_000 });
    await expect(page.locator(".card")).toHaveCount(2, { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    // The transcript is also kept in the Data tab's activity log.
    await expect(page.locator("#activity")).toHaveValue(new RegExp(`saved: ${EXAMPLE.home.name}`));

    // The home page keeps answering for itself while the next one is on its
    // way; a word from the page being left must not pass for the next page's
    // confirmation. The next page never confirms as the listing its URL
    // names, and the one after never confirms at all. Each makes the run stop
    // and wait on the person at the tab, who skips it. Neither is saved.
    const waiting = "Waiting on the tab: no listing was confirmed on the page. Answer any check the site shows there, or Skip the page.";
    await expect(action(page, "skip")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#load-log li").last()).toHaveText(waiting);
    await action(page, "skip").click();
    await expect(page.locator("#load-log li").last()).toHaveText(`3/3  ${DEAD_URL}`);
    await expect(action(page, "skip")).toBeVisible({ timeout: 30_000 });
    await action(page, "skip").click();
    await expect(action(page, "close")).toBeVisible();
    expect((await logLines(page)).slice(-7)).toEqual([
        `2/3  ${OTHER_URL}`,
        waiting,
        "    failed: no listing was confirmed on the page; skipped",
        `3/3  ${DEAD_URL}`,
        waiting,
        "    failed: no listing was confirmed on the page; skipped",
        "Loaded 3 of 3. 1 saved, 2 failed.",
    ]);
    await expect(page.locator("#data-status")).toHaveText("Loaded 3 of 3. 1 saved, 2 failed.");

    const saved = await worker.evaluate(async (ref) => {
        const listing = await __intel!.db.listings.where("[source+sourceId]").equals([ref.source, ref.sourceId]).first();
        return { address: listing?.core.address.text, count: await __intel!.db.listings.count() };
    }, { source: "example", sourceId: EXAMPLE.home.id });
    expect(saved).toEqual({ address: EXAMPLE.home.address, count: 2 });

    // One tab did the loading, and it is left where it finished.
    const loaders = context.pages().filter((p) => p.url().includes("listings.example"));
    expect(loaders).toHaveLength(1);
    expect(loaders[0]!.url()).toBe(DEAD_URL);

    // Load more: the same list again has only the failed page left, and Cancel mid-load ends the run there and then.
    await action(page, "more").click();
    await expect(page.locator("#load-text")).toHaveValue("");
    await page.locator("#load-text").fill(`${HOME_URL}\n${DEAD_URL}`);
    await action(page, "check").click();
    await expect(page.locator("#load-log li").last()).toHaveText("Ready to load 1 listing (1 from example) in the active tab, one at a time.");
    await action(page, "start").click();
    await expect(page.locator("#load-log li").last()).toHaveText(`1/1  ${DEAD_URL}`);
    await action(page, "cancel").click();
    await expect(page.locator("#load-log li").last()).toHaveText("Loaded 0 of 1. Cancelled.");
    await expect(action(page, "close")).toBeVisible();

    // A list with nothing new in it never gets a Start button, and the log survives until cleared.
    await action(page, "more").click();
    await page.locator("#load-text").fill(`${HOME_URL}\n${SAVED_URL}\n`);
    await action(page, "check").click();
    await expect(page.locator("#load-log li").last()).toHaveText("Nothing to load: every listing is already saved.");
    await expect(action(page, "start")).toBeHidden();
    await action(page, "close").click();
    await expect(dialog).toBeHidden();
    await page.locator("#load-urls").click();
    await expect(page.locator("#load-log li").last()).toHaveText("Nothing to load: every listing is already saved.");
    await action(page, "clear-log").click();
    await expect(page.locator("#load-log")).toBeHidden();
});
