import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { expect, openPanel, test, waitForContentScript, workerOf } from "../harness/extension";
import { serveBuiltSite } from "../harness/site";
import { listings, listingUrl } from "../../site/src/data";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One screenshot of the side panel for each numbered step of the README's
 * Usage section (`npm run readme:images`), plus a thumbnail of each that
 * the README shows and links to the full image. The panel is filled by
 * capturing listings from the built example site (`npm run site:build`),
 * so, as with the store artwork, nothing from a real site appears.
 *
 * Step 1 is the Sources tab with the sites still off. The test build
 * declares every host as required, so its sites can never be off; that
 * one shot comes from the release build in dist/ instead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../docs/images/usage");
const RELEASE = resolve(HERE, "../../dist");

const PANEL = { width: 420, height: 780 };
const THUMB_HEIGHT = 200;

/** The listings the panel starts with, a building first; the list the dialog loads; the page step 2 is on. */
const SAVED = listings.slice(0, 8);
const LOADED = listings.slice(8, 12);
const OPENED = listings[12]!;

async function capture(context: BrowserContext, page: Page, panel: Page, url: string): Promise<void> {
    await page.goto(url);
    await waitForContentScript(context, page);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 15_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    // "Saved." alone once the photos are in.
    await expect(panel.locator("#capture-note")).toHaveText("Saved.", { timeout: 30_000 });
}

/** Writes the panel as shot and, as its thumbnail, the same shot scaled to THUMB_HEIGHT tall. The panel reads the active tab, so `front` is the tab the shot is of and stays in front; the panel is drawn from behind it. */
async function shoot(context: BrowserContext, panel: Page, front: Page, name: string): Promise<void> {
    await front.bringToFront();
    await panel.mouse.move(0, 0);
    await panel.waitForTimeout(300);
    const shot = await panel.screenshot({ path: resolve(OUT, `${name}.png`) });
    const width = Math.round((PANEL.width * THUMB_HEIGHT) / PANEL.height);
    const page = await context.newPage();
    await page.setViewportSize({ width, height: THUMB_HEIGHT });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; width: ${width}px; height: ${THUMB_HEIGHT}px; overflow: hidden; }
        img { display: block; width: ${width}px; height: ${THUMB_HEIGHT}px; }
    </style></head><body><img src="data:image/png;base64,${shot.toString("base64")}" alt=""></body></html>`);
    await page.screenshot({ path: resolve(OUT, `${name}-thumb.png`), type: "png" });
    await page.close();
    await front.bringToFront();
}

test("the Sources tab of the release build, every site off", async () => {
    if (!existsSync(resolve(RELEASE, "manifest.json"))) throw new Error(`The release build is missing: run \`npm run build\` first (looked in ${RELEASE}).`);
    mkdirSync(OUT, { recursive: true });
    const context = await chromium.launchPersistentContext("", {
        channel: "chromium",
        args: [`--disable-extensions-except=${RELEASE}`, `--load-extension=${RELEASE}`],
    });
    try {
        const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
        const panel = await openPanel(context, new URL(worker.url()).host, 0);
        await panel.setViewportSize(PANEL);
        await panel.locator('.tabs button[data-tab="sources"]').click();
        await expect(panel.locator("#sources .source-row")).toHaveCount(3);
        await expect(panel.locator("#sources .source-row.enabled")).toHaveCount(0);
        await shoot(context, panel, panel, "1-enable-a-site");
    } finally {
        await context.close();
    }
});

test("the other five steps, from the test build on the example site", async ({ context, extensionId }) => {
    mkdirSync(OUT, { recursive: true });
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveBuiltSite(context);
    const worker = await workerOf(context);

    const page = await context.newPage();
    await page.goto(listingUrl(SAVED[0]!.id));
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await panel.setViewportSize(PANEL);
    for (const l of SAVED) await capture(context, page, panel, listingUrl(l.id));

    // A person has been using it: statuses and a note.
    await worker.evaluate(async (ids) => {
        const set = async (sourceId: string, fields: Record<string, unknown>) => {
            const listing = await __intel!.db.listings.where("[source+sourceId]").equals(["example", sourceId]).first();
            if (listing) await __intel!.db.listings.update(listing.id, fields as never);
        };
        await set(ids[0]!, { "user.status": "scheduled", "user.notes": "Tour Sat 11am. Ask about the garage units and the move-in special." });
        await set(ids[1]!, { "user.status": "interested" });
        await set(ids[2]!, { "user.status": "not-interested", "user.notes": "Mostly studios, two 1bd left." });
        await set(ids[3]!, { "user.status": "visited" });
        await set(ids[5]!, { "user.status": "rejected", "user.notes": "No parking." });
    }, SAVED.map((l) => l.id));

    // 2. On a listing not yet saved: the button offers to add it.
    await page.goto(listingUrl(OPENED.id));
    await waitForContentScript(context, page);
    await page.bringToFront();
    await expect(panel.locator("#capture-button")).toHaveText("Add listing", { timeout: 15_000 });
    await expect(panel.locator(".card")).toHaveCount(SAVED.length);
    while ((await panel.locator(".card.open").count()) > 0) {
        await panel.locator(".card.open").first().locator("h2 .title").click();
        await panel.waitForTimeout(150);
    }
    await shoot(context, panel, page, "2-open-a-listing");

    // 3. The search box and filters narrowing the list, one card open.
    await expect(panel.locator("#controls-toggle")).toHaveAttribute("aria-expanded", "true");
    await panel.locator("#search").fill("cats");
    await panel.locator("#beds-min").selectOption("1");
    await panel.waitForTimeout(300);
    const shown = panel.locator(".card");
    if ((await shown.count()) > 0) {
        await shown.first().locator("h2 .title").click();
        await expect(shown.first()).toHaveClass(/open/);
    }
    await shoot(context, panel, page, "3-search-and-filter");
    await panel.locator("#search").fill("");
    await panel.locator("#beds-min").selectOption("");

    // 4. The Load URLs dialog after a run of four pages.
    await panel.locator('.tabs button[data-tab="data"]').click();
    await panel.locator("#load-urls").click();
    const dialog = panel.locator("#load-dialog");
    await expect(dialog).toBeVisible();
    await panel.locator("#load-text").fill(LOADED.map((l) => listingUrl(l.id)).join("\n"));
    await panel.locator('#load-buttons button[data-action="check"]').click();
    await expect(panel.locator('#load-buttons button[data-action="start"]')).toBeVisible();
    await panel.locator('#load-buttons button[data-action="start"]').click();
    await expect(panel.locator('#load-buttons button[data-action="close"]')).toBeVisible({ timeout: 120_000 });
    await shoot(context, panel, page, "4-load-a-list");
    await panel.locator('#load-buttons button[data-action="close"]').click();
    await expect(dialog).toBeHidden();

    // 5. The Data tab: backup, restore and the activity log of what just happened.
    await shoot(context, panel, page, "5-back-up");

    // 6. Options.
    await panel.locator('.tabs button[data-tab="options"]').click();
    await shoot(context, panel, page, "6-options");
});
