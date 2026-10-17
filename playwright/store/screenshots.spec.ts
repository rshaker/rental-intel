import { expect, openPanel, test, waitForContentScript, workerOf } from "../harness/extension";
import { serveBuiltSite } from "../harness/site";
import { listings, listingUrl } from "../../site/src/data";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Chrome Web Store artwork from the real extension (`npm run store:artwork`): the side panel, filled
 * by capturing listings from the built example site (listings.example,
 * `npm run site:build`), composed onto 1280x800 frames with a headline
 * each; a 440x280 promo tile and a 1400x560 marquee from the icon.
 *
 * Every listing on that site is invented and its photos are generated
 * SVGs, so no real site's data or photographs end up in marketing material.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../work/store");
const ICON = readFileSync(resolve(HERE, "../../src/icons/icon-128.png")).toString("base64");

/** The nine the artwork shows: the site's first nine listings, a building first. */
const PICKS = listings.slice(0, 9);

const PANEL = { width: 420, height: 780 };

async function serveSites(context: BrowserContext): Promise<void> {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    await serveBuiltSite(context);
}

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

/** The panel screenshot on a 1280x800 frame, with a headline. */
async function frame(context: BrowserContext, shot: Buffer, title: string, lead: string, file: string, dark = false): Promise<void> {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const bg = dark ? "linear-gradient(135deg, #0f1117 0%, #1d2026 60%, #262a3a 100%)" : "linear-gradient(135deg, #eef2ff 0%, #ffffff 55%, #f3f4f6 100%)";
    const fg = dark ? "#e6e8eb" : "#1f2328";
    const muted = dark ? "#9ca3af" : "#6b7280";
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
        body { background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: ${fg}; display: flex; align-items: center; }
        .text { flex: 1; padding: 0 56px 0 72px; }
        .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 36px; color: ${muted}; font-size: 20px; font-weight: 600; letter-spacing: 0.2px; }
        .brand img { width: 40px; height: 40px; border-radius: 10px; }
        h1 { font-size: 46px; line-height: 1.12; margin: 0 0 22px; font-weight: 700; letter-spacing: -0.5px; }
        p { font-size: 22px; line-height: 1.45; margin: 0; color: ${muted}; max-width: 520px; }
        .panel { flex: none; margin-right: 64px; width: ${PANEL.width}px; height: ${PANEL.height}px; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 80px rgba(15, 17, 23, ${dark ? 0.7 : 0.22}), 0 2px 6px rgba(15, 17, 23, 0.12); border: 1px solid ${dark ? "#2b2f36" : "#e5e7eb"}; }
        .panel img { display: block; width: ${PANEL.width}px; height: ${PANEL.height}px; }
    </style></head><body>
        <div class="text"><div class="brand"><img src="data:image/png;base64,${ICON}" alt="">Rental Intel</div><h1>${title}</h1><p>${lead}</p></div>
        <div class="panel"><img src="data:image/png;base64,${shot.toString("base64")}" alt=""></div>
    </body></html>`);
    await page.screenshot({ path: resolve(OUT, file), type: "jpeg", quality: 92 });
    await page.close();
}

async function tile(context: BrowserContext, width: number, height: number, file: string): Promise<void> {
    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    const big = width > 1000;
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
        body { background: linear-gradient(135deg, #4f46e5 0%, #6366f1 45%, #818cf8 100%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; gap: ${big ? 56 : 28}px; }
        img { width: ${big ? 200 : 112}px; height: ${big ? 200 : 112}px; border-radius: ${big ? 44 : 26}px; box-shadow: 0 18px 50px rgba(0,0,0,0.35); }
        h1 { margin: 0 0 ${big ? 14 : 6}px; font-size: ${big ? 76 : 40}px; letter-spacing: -1px; font-weight: 700; }
        p { margin: 0; font-size: ${big ? 28 : 17}px; opacity: 0.92; max-width: ${big ? 640 : 250}px; line-height: 1.3; }
    </style></head><body>
        <img src="data:image/png;base64,${ICON}" alt=""><div><h1>Rental Intel</h1><p>Rental listings from every site, saved to one list on your computer.</p></div>
    </body></html>`);
    await page.screenshot({ path: resolve(OUT, file), type: "png" });
    await page.close();
}

test("store artwork", async ({ context, extensionId }) => {
    mkdirSync(OUT, { recursive: true });
    await serveSites(context);
    const worker = await workerOf(context);

    const page = await context.newPage();
    await page.goto(listingUrl(PICKS[0]!.id));
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await panel.setViewportSize(PANEL);
    for (const l of PICKS) await capture(context, page, panel, listingUrl(l.id));

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
        await set(ids[4]!, { "user.status": "interested" });
        await set(ids[5]!, { "user.status": "rejected", "user.notes": "No parking." });
    }, PICKS.map((l) => l.id));

    await panel.bringToFront();
    await expect(panel.locator(".card")).toHaveCount(9);

    // The Filters box folded away, so the cards have the panel.
    await panel.locator("#controls-toggle").click();
    await expect(panel.locator("#controls-toggle")).toHaveAttribute("aria-expanded", "false");

    // 1. The list, every card closed: the aligned rows.
    while ((await panel.locator(".card.open").count()) > 0) {
        await panel.locator(".card.open").first().locator("h2 .title").click();
        await panel.waitForTimeout(150);
    }
    await panel.mouse.move(0, 0);
    await frame(context, await panel.screenshot(), "Every listing you looked at, in one list", "Zillow and Apartments.com, saved to your computer with one click. No account, no server.", "screenshot-1-list.jpg");

    // 2. One card open: photos, status, details, units.
    const first = panel.locator(".card", { has: panel.locator(".title", { hasText: PICKS[0]!.name }) });
    await first.locator("h2 .title").click();
    await expect(first).toHaveClass(/open/);
    await first.locator(".field-toggle", { hasText: "Details" }).click();
    await first.locator(".field-toggle", { hasText: "Units" }).click();
    await panel.evaluate(() => {
        const card = document.querySelector<HTMLElement>(".card.open");
        const head = document.querySelector<HTMLElement>(".head");
        if (!card) return;
        card.style.scrollMarginTop = `${(head?.offsetHeight ?? 0) + 8}px`;
        card.scrollIntoView({ block: "start" });
    });
    await panel.waitForTimeout(600);
    await frame(context, await panel.screenshot(), "The whole listing, kept", "Photos, floor plans and units, fees, the description, plus your own status and notes on each.", "screenshot-2-card.jpg");

    // 3. Search tab: the example site searched, with its filters open.
    await panel.locator('.tabs button[data-tab="search"]').click();
    const row = panel.locator('.search-row[data-source="example"]');
    await page.bringToFront();
    await row.locator('input[type="search"]').fill("Austin, TX");
    await row.locator('input[type="search"]').press("Enter");
    await expect(row.locator(".search-results li")).toHaveCount(listings.length, { timeout: 30_000 });
    await panel.bringToFront();
    await row.locator(".search-filters-toggle").click();
    await panel.waitForTimeout(300);
    await frame(context, await panel.screenshot(), "Search the sites from the panel", "Your words and filters land on the site's own results page, in your tab. Add what you find to the list.", "screenshot-3-search.jpg");

    // 4. Sources: opt in per site.
    await panel.locator('.tabs button[data-tab="sources"]').click();
    // The test build carries the synthetic example source; the real one does not.
    await panel.addStyleTag({ content: '#sources .source-row[data-source="example"] { display: none; }' });
    await panel.waitForTimeout(300);
    await frame(context, await panel.screenshot(), "Sites are off until you turn them on", "Access is asked for one site at a time, only when you enable it, and given back when you disable it.", "screenshot-4-sources.jpg");

    // 5. Options, in dark mode.
    await panel.emulateMedia({ colorScheme: "dark" });
    await panel.locator('.tabs button[data-tab="options"]').click();
    await panel.waitForTimeout(300);
    await frame(context, await panel.screenshot(), "Tuned to how you search", "Photo limits, page timing, the status a new listing starts with, which details to show. Light and dark.", "screenshot-5-options.jpg", true);
    await panel.emulateMedia({ colorScheme: "light" });

    await tile(context, 440, 280, "promo-tile-440x280.png");
    await tile(context, 1400, 560, "marquee-1400x560.png");
});
