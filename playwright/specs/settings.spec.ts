import { expect, test, workerOf } from "../harness/extension";
import { seedListing } from "../harness/seed";
import type { Page } from "@playwright/test";

/**
 * End-to-end coverage of settings: the table is seeded with the registry's
 * defaults, the side panel's Settings tab and the options page both render
 * the registry and write through to the table, a value outside its bounds
 * is refused, the chosen tab survives a reload, and a setting actually
 * changes behaviour (a new listing's status). The registry itself and the
 * merge rules are pinned by src/db/settingsSchema.test.ts.
 */

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

test("settings are seeded, editable from the panel tab and the options page, bounded, and used", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    const stored = () =>
        worker.evaluate(async () => ({ rows: await __intel!.db!.settings.count(), settings: await __intel!.settings!.get() }));

    // A fresh database already holds every default.
    const fresh = await stored();
    expect(fresh.rows).toBe(Object.keys(fresh.settings).length);
    expect(fresh.settings).toMatchObject({ "bulk.pace": 2, "photos.save": true, "listings.defaultStatus": "none" });

    // The Options tab hides the list and shows the form, filled from the table.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/panel/index.html`);
    await expect(page.locator(".empty")).toContainText("No listings yet");
    await page.locator('.tabs button[data-tab="options"]').click();
    await expect(page.locator("#options")).toBeVisible();
    await expect(page.locator("#root")).toBeHidden();
    await expect(page.locator("#listings-head")).toBeHidden();
    await expect(setting(page, "bulk.pace")).toHaveValue("2");
    await expect(setting(page, "photos.save")).toBeChecked();
    await expect(page.locator(".settings-section h2")).toHaveText(["Appearance", "Loading lists", "Searching sites", "Photos", "Listings", "Details rows"]);

    // Edits write through at once.
    await setting(page, "bulk.pace").fill("5");
    await setting(page, "bulk.pace").press("Tab");
    await expect(page.locator(".settings-status")).toHaveText("Saved pause between listings.");
    await setting(page, "photos.save").uncheck();
    await setting(page, "listings.defaultStatus").selectOption("visited");
    expect((await stored()).settings).toMatchObject({ "bulk.pace": 5, "photos.save": false, "listings.defaultStatus": "visited" });

    // A number outside its bounds is put back and not written.
    await setting(page, "bulk.pace").fill("999");
    await setting(page, "bulk.pace").press("Tab");
    await expect(page.locator(".settings-status")).toContainText("must be between 0 and 60");
    await expect(setting(page, "bulk.pace")).toHaveValue("5");
    expect((await stored()).settings["bulk.pace"]).toBe(5);

    // The tab survives a reload, and so do the values.
    await page.reload();
    await expect(page.locator("#options")).toBeVisible();
    await expect(setting(page, "bulk.pace")).toHaveValue("5");
    await expect(setting(page, "photos.save")).not.toBeChecked();

    // A setting is used: a listing saved now starts out as "visited".
    const id = await seedListing(worker, { sourceId: "seeded01", url: "https://listings.example/l/seeded01/", rent: 1, core: { address: { line1: "1 Test St", unit: null, city: null, state: null, zip: null, text: "1 Test St" } } });
    const status = await worker.evaluate(async (id) => (await __intel!.get!(id))?.user.status, id);
    expect(status).toBe("visited");

    // The options page is the same form on its own page, and sees the same table.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    await expect(options.locator("h1")).toHaveText("Rental Intel settings");
    await expect(setting(options, "bulk.pace")).toHaveValue("5");
    await setting(options, "bulk.maxConsecutiveFailures").fill("7");
    await setting(options, "bulk.maxConsecutiveFailures").press("Tab");
    expect((await stored()).settings["bulk.maxConsecutiveFailures"]).toBe(7);

    // Reset puts everything back, and the panel shows it.
    await options.locator('[data-action="reset-settings"]').click();
    await expect(options.locator(".settings-status")).toHaveText("Every setting is back to its default.");
    await expect(setting(options, "bulk.pace")).toHaveValue("2");
    expect((await stored()).settings).toEqual(fresh.settings);
    await page.reload();
    await expect(setting(page, "bulk.maxConsecutiveFailures")).toHaveValue("3");

    // The Size setting is drawn: the body is zoomed by it, which the options
    // page publishes to the open panel at once, and the panel keeps it over a
    // reload. The Load URLs dialog, sized in viewport units, still fits.
    const scale = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim());
    expect(await scale()).toBe("1");
    await setting(options, "appearance.scale").selectOption("150");
    await expect.poll(scale).toBe("1.5");
    expect(await page.evaluate(() => getComputedStyle(document.body).zoom)).toBe("1.5");
    await page.reload();
    expect(await scale()).toBe("1.5");
    await page.locator('.tabs button[data-tab="data"]').click();
    await page.locator("#load-urls").click();
    const dialog = page.locator("#load-dialog");
    await expect(dialog).toBeVisible();
    const fit = await page.evaluate(() => {
        const box = document.querySelector("#load-dialog")!.getBoundingClientRect();
        return { right: Math.round(box.right), width: window.innerWidth, bottom: Math.round(box.bottom), height: window.innerHeight };
    });
    expect(fit.right).toBeLessThanOrEqual(fit.width);
    expect(fit.bottom).toBeLessThanOrEqual(fit.height);
    await dialog.locator('[data-action="close"]').click();

    // The zoom keys step it from anywhere in the panel, and the form follows.
    await page.locator('.tabs button[data-tab="options"]').click();
    await expect(setting(page, "appearance.scale")).toHaveValue("150");
    await page.locator("#search").focus();
    await page.locator('.tabs button[data-tab="listings"]').click();
    await page.keyboard.press("ControlOrMeta+Equal");
    await expect.poll(scale).toBe("1.75");
    await page.keyboard.press("ControlOrMeta+Minus");
    await page.keyboard.press("ControlOrMeta+Minus");
    await expect.poll(scale).toBe("1.25");
    await expect.poll(() => stored().then((s) => s.settings["appearance.scale"])).toBe("125");
    await page.locator('.tabs button[data-tab="options"]').click();
    await expect(setting(page, "appearance.scale")).toHaveValue("125");
    await page.keyboard.press("ControlOrMeta+Digit0");
    await expect.poll(scale).toBe("1");
    await expect(setting(page, "appearance.scale")).toHaveValue("100");

    // Back to the list, which is still there.
    await page.locator('.tabs button[data-tab="listings"]').click();
    await expect(page.locator("#root")).toBeVisible();
    await expect(page.locator(".card")).toHaveCount(1);
    await expect(page.locator("#options")).toBeHidden();

    // A Details row switch drops that row from every card, at once.
    const card = page.locator(".card").first();
    await card.locator("h2 .title").click();
    await card.locator(".field-toggle", { hasText: "Details" }).click();
    const terms = () => card.locator(".details dt").allTextContents();
    expect(await terms()).toEqual(["Address", "Rent", "Source", "Read from", "Saved", "Updated", "Captured"]);
    await page.locator('.tabs button[data-tab="options"]').click();
    await setting(page, "details.source").uncheck();
    await setting(page, "details.saved").uncheck();
    await page.locator('.tabs button[data-tab="listings"]').click();
    await expect.poll(terms).toEqual(["Address", "Rent", "Read from", "Updated", "Captured"]);
    // The card and its Details section are open across the reload.
    await page.reload();
    await expect.poll(terms).toEqual(["Address", "Rent", "Read from", "Updated", "Captured"]);
});
