import { expect, fixtureHtml, openPanel, test, waitForContentScript, workerOf } from "../harness/extension";

/** Zillow through the panel: a home and a building from trimmed captures, the building's units, and the single-page-app paths. */

const HOME_URL = "https://www.zillow.com/homedetails/710-E-Dean-Keeton-St-111-Austin-TX-78705/450233440_zpid/";
const BUILDING_URL = "https://www.zillow.com/apartments/austin-tx/lenox-grand/CmB93F/";
const SEARCH_URL = "https://www.zillow.com/portland-or/rentals/";

test.beforeEach(async ({ context }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    const home = fixtureHtml("zillow-listing.html");
    const building = fixtureHtml("zillow-building.html");
    const buildingB = fixtureHtml("zillow-building-b.html");
    const search = fixtureHtml("zillow-search.html");
    await context.route("https://www.zillow.com/**", (route) => {
        const url = route.request().url();
        route.fulfill({ contentType: "text/html", body: url.includes("_zpid") ? home : url.includes("/apartments/") ? building : url.includes("/b/") ? buildingB : search });
    });
    await context.route("https://photos.zillowstatic.com/**", (route) => route.fulfill({ status: 404 }));
});

test("captures a home and a building, and relates the building's units", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(HOME_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await panel.bringToFront();
    const home = panel.locator(".card").first();
    await expect(home.locator(".title")).toHaveText("710 E Dean Keeton St #111, Austin, TX 78705");
    await expect(home.locator(".source-badge")).toHaveText("ZIL");
    await expect(home.locator(".kind")).toContainText("Home");
    await home.locator(".field-toggle", { hasText: "Details" }).click();
    await expect(home.locator(".details")).toContainText("Building");
    await expect(home.locator(".details a[href*='CvBTSB']")).toHaveCount(1);

    await page.goto(BUILDING_URL);
    await waitForContentScript(context, page);
    await page.bringToFront();
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await panel.bringToFront();
    await expect(panel.locator(".card")).toHaveCount(2);
    const building = panel.locator(".card", { has: panel.locator(".title", { hasText: "Lenox Grand" }) });
    await expect(building).toHaveCount(1);
    await building.locator(".field-toggle", { hasText: "Units" }).click();
    await expect(building.locator(".units li")).toHaveCount(51);
    await expect(building.locator(".units li").first()).toContainText("Unit 04104");
    await expect(building.locator(".units li").first().locator("a.icon")).toHaveAttribute("href", "https://www.zillow.com/homedetails/2056262621_zpid/");

    const worker = await workerOf(context);
    const stored = await worker.evaluate(async () => (await __intel!.db.listings.toArray()).map((l) => [l.sourceId, l.kind, l.core.plans.length]).sort());
    expect(stored).toEqual([
        ["450233440", "home", 0],
        ["CmB93F", "building", 9],
    ]);
});

test("a pushState between URLs is noticed without a document load", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(HOME_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });

    // The URL leaves the listing with no DOM change; the listing is withdrawn.
    await page.evaluate((url) => history.pushState({}, "", url), SEARCH_URL);
    await expect(button).toHaveText("Try to capture", { timeout: 10_000 });

    // And back: the document still describes the home, so it confirms again.
    await page.evaluate((url) => history.pushState({}, "", url), HOME_URL);
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
});

test("a replaceState of the current URL, as Next.js does after hydrating, changes nothing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(HOME_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });

    // Chrome reports this as a load with no new URL; the panel keeps what it was told.
    await page.evaluate(() => history.replaceState(history.state, "", location.href));
    await page.waitForTimeout(1_500);
    await expect(button).toHaveText("Add listing");
    await expect(panel.locator("#capture-note")).toHaveText("");
});

test("moving the tab from a saved building to an unsaved home never says the wrong thing", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(BUILDING_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await expect(button).toHaveText("Re-capture");

    // The row may say the page is being looked at, then what it found; never "No listing confirmed" nor the outgoing page's "Re-capture".
    const states: string[] = [];
    const watch = (async () => {
        for (let i = 0; i < 100; i++) {
            const state = `${await button.textContent()} / ${await panel.locator("#capture-note").textContent()}`;
            if (states[states.length - 1] !== state) states.push(state);
            await panel.waitForTimeout(50);
        }
    })();
    await panel.evaluate((url) => chrome.tabs.update({ url }), HOME_URL);
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await watch;
    // The first state is the building's, from before the move.
    const after = states.slice(1);
    const unexpected = after.filter((state) => state.includes("No listing confirmed") || state.startsWith("Re-capture"));
    expect(unexpected, states.join("\n")).toEqual([]);
    expect(after[after.length - 1]).toBe("Add listing / ");
});

test("a tab that moved between listings in-page is read through the router bridge", async ({ context, extensionId }) => {
    // The home fixture served at another listing's URL, with a router holding the current listing's props as Zillow's does after an in-page move.
    const STALE_URL = "https://www.zillow.com/homedetails/1-Bridge-St-Austin-TX-78701/999999999_zpid/";
    await context.addInitScript(() => {
        const property = { zpid: 999999999, price: 4321, bedrooms: 3, bathrooms: 2, livingArea: 1200, homeType: "CONDO", address: { streetAddress: "1 Bridge St", city: "Austin", state: "TX", zipcode: "78701" }, originalPhotos: [] };
        (window as unknown as Record<string, unknown>)["next"] = {
            router: {
                route: "/homedetails/[[...slug]]",
                components: { "/homedetails/[[...slug]]": { props: { pageProps: { componentProps: { gdpClientCache: { "Query{}": { property } } } } } } },
                events: { on: () => undefined },
            },
        };
    });
    const page = await context.newPage();
    await page.goto(STALE_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    // The canonical link still names the first listing, so the page is not confirmed; a manual capture reads the router's state.
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Try to capture");
    await expect.poll(() => page.locator("#__intel_zillow_state").count(), { timeout: 10_000 }).toBe(1);
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await panel.bringToFront();
    const card = panel.locator(".card").first();
    await expect(card.locator(".title")).toHaveText("1 Bridge St, Austin, TX 78701");
    await expect(card.locator(".facts").first()).toContainText("$4,321");
    await expect(card.locator(".facts").first()).toContainText("3bd/2ba");
    await card.locator(".field-toggle", { hasText: "Details" }).click();
    await expect(card.locator(".details")).toContainText("hydration");
});

test("a page whose data cannot be read is saved from its layout, and says so", async ({ context, extensionId }) => {
    // The home fixture at a URL its payload does not describe, and no router.
    const OTHER_URL = "https://www.zillow.com/homedetails/Somewhere-Else/888888888_zpid/";
    const page = await context.newPage();
    await page.goto(OTHER_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Try to capture");
    await button.click();
    await expect(panel.locator("#capture-note")).toContainText("Saved from the page layout only");
    await panel.bringToFront();
    const card = panel.locator(".card").first();
    await card.locator(".field-toggle", { hasText: "Details" }).click();
    await expect(card.locator(".details")).toContainText("page layout only");
});

const BUILDING_B_URL = "https://www.zillow.com/b/710-e-dean-keeton-st-austin-tx-CvBTSB/";

test("captures the older /b/ building shape, units and all", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(BUILDING_B_URL);
    await waitForContentScript(context, page);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();
    const button = panel.locator("#capture-button");
    await expect(button).toHaveText("Add listing", { timeout: 10_000 });
    await button.click();
    await expect(panel.locator("#capture-note")).toHaveText(/^Saved\./);
    await expect(button).toHaveText("Re-capture");
    await expect(panel.locator("#locate-button")).toBeEnabled();
    const card = panel.locator(".card").first();
    // The site gives this lot no name, so the card is titled by its address.
    await expect(card.locator(".title")).toHaveText("710 E Dean Keeton St, Austin, TX 78705");

    // Show card opens the active tab's card and brings it into view.
    await card.locator("h2 .title").click();
    await expect(card).not.toHaveClass(/open/);
    await panel.locator("#locate-button").click();
    await expect(card).toHaveClass(/open/);
    expect(await card.evaluate((el) => el.getBoundingClientRect().bottom <= window.innerHeight && el.getBoundingClientRect().top >= 0)).toBe(true);
    await panel.bringToFront();
    await expect(card.locator(".facts").first()).toContainText("$995 – $1,495");
    await card.locator(".field-toggle", { hasText: "Units" }).click();
    await expect(card.locator(".units li")).toHaveCount(27);
    await expect(card.locator(".units li.unit-off")).toHaveCount(22);
    await expect(card.locator(".units li").first()).toContainText("Unit 211");
});

test("a listing tab with no content script is given one by the capture button", async ({ context, extensionId }) => {
    // What an extension reload leaves in an open tab: the page is a listing, the source is on, and nobody answers.
    const worker = await workerOf(context);
    const ids = ["source:zillow", "source:zillow:main"];
    await expect.poll(() => worker.evaluate(async (ids) => (await chrome.scripting.getRegisteredContentScripts({ ids })).length, ids)).toBe(2);
    await worker.evaluate((ids) => chrome.scripting.unregisterContentScripts({ ids }), ids);
    const page = await context.newPage();
    await page.goto(BUILDING_B_URL);
    const panel = await openPanel(context, extensionId, 0);
    await page.bringToFront();

    const button = panel.locator("#capture-button");
    const note = panel.locator("#capture-note");
    await expect(button).toHaveText("Try to capture");
    await expect(note).toHaveText("No listing confirmed on this tab.");

    // The button puts a script there and reads the page.
    await button.click();
    await expect(note).toHaveText(/^Saved\./);
    await expect(button).toHaveText("Re-capture", { timeout: 10_000 });
    await expect(panel.locator("#locate-button")).toBeEnabled();
    await panel.bringToFront();
    await expect(panel.locator(".card").first().locator(".title")).toHaveText("710 E Dean Keeton St, Austin, TX 78705");

    // The rescue is on the record.
    await panel.locator('button[data-tab="data"]').click();
    await expect(panel.locator("#activity")).toHaveValue(/had no content script; injected one/);
});
