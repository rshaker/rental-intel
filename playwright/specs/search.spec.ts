import { EXAMPLE, expect, fixtureFor, openPanel, serveExampleSite, test, workerOf } from "../harness/extension";

/**
 * The Search tab, end to end on the example site: a query opens the site's
 * search page in the tab beside the panel, the content script reads the
 * result list off it, the panel lists the results, the tab is left on the
 * results page, and a result sends that tab on to the listing. Then the
 * ways a run ends without results: an empty page, a page that never becomes
 * a search page (what a bot check looks like), and Cancel.
 *
 * The panel here is a page of its own, so another page is brought to the
 * front first: that is the tab beside the panel.
 */

const row = (panel: import("@playwright/test").Page) => panel.locator('.search-row[data-source="example"]');

test("a site search runs in the tab beside the panel, lists its results, and a result opens in that tab", async ({ context, extensionId }) => {
    await serveExampleSite(context);
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    await expect(panel.locator("#search-pane")).toBeVisible();
    await expect(panel.locator("#root")).toBeHidden();
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();

    const site = row(panel);
    await expect(site).toHaveClass(/enabled/);
    await expect(site.locator(".source-name")).toHaveText("Example listings");
    await site.locator('input[type="search"]').fill("Springfield, IL");
    await site.locator('input[type="search"]').press("Enter");

    await expect(site.locator(".search-status")).toContainText("2 results", { timeout: 20_000 });
    const links = site.locator(".search-results li a");
    await expect(links).toHaveText([EXAMPLE.building.name, EXAMPLE.home.name]);
    await expect(links.nth(0)).toHaveAttribute("href", EXAMPLE.building.url);
    await expect(links.nth(1)).toHaveAttribute("href", EXAMPLE.home.url);
    await expect(site.locator(".search-results li").nth(1)).toContainText("$2,400 · 2bd/1ba · 1,150 sqft");
    await expect(site.locator(".search-status a")).toHaveAttribute("href", "https://listings.example/search/springfield-il/");

    // The search ran in the tab beside the panel, which is left on the results page; no other tab was opened.
    await expect(page).toHaveURL("https://listings.example/search/springfield-il/");
    expect(context.pages().filter((p) => p.url().includes("listings.example"))).toHaveLength(1);

    // A result goes on to the listing in that tab, so Back returns to the results.
    await links.nth(1).click();
    await expect(page).toHaveURL(EXAMPLE.home.url);

    // The results outlive a tab switch, and both the tab choice and the
    // results a reload: the panel the user sees may not be the document
    // that ran the search.
    await panel.locator('.tabs button[data-tab="listings"]').click();
    await panel.locator('.tabs button[data-tab="search"]').click();
    await expect(site.locator(".search-results li")).toHaveCount(2);
    await panel.reload();
    await expect(panel.locator("#search-pane")).toBeVisible();
    await expect(row(panel).locator('input[type="search"]')).toHaveValue("Springfield, IL");
    await expect(row(panel).locator(".search-status")).toContainText("2 results");
    await expect(row(panel).locator(".search-results li a")).toHaveText([EXAMPLE.building.name, EXAMPLE.home.name]);

    // The list folds away under its status line and comes back, and stays folded over a reload.
    await row(panel).locator(".search-toggle").click();
    await expect(row(panel).locator(".search-results")).toBeHidden();
    await expect(row(panel).locator(".search-status")).toContainText("2 results");
    await panel.reload();
    await expect(row(panel).locator(".search-results")).toBeHidden();
    await expect(row(panel).locator(".search-toggle")).toHaveText("Show");
    await row(panel).locator(".search-toggle").click();
    await expect(row(panel).locator(".search-results li")).toHaveCount(2);

    // "Add to listings" hands the results to Load URLs, checked and ready to start.
    await row(panel).locator(".search-load").click();
    await expect(panel.locator("#load-dialog")).toBeVisible();
    await expect(panel.locator("#load-log")).toContainText("Ready to load 2 listings");
    await panel.locator('#load-buttons button[data-action="back"]').click();
    await expect(panel.locator("#load-text")).toHaveValue(`${EXAMPLE.building.url}\n${EXAMPLE.home.url}\n`);
    await panel.locator('#load-buttons button[data-action="close"]').click();

    // Clear forgets the results and the status; the typed text stays for the next run.
    await row(panel).locator(".search-clear").click();
    await expect(row(panel).locator(".search-results li")).toHaveCount(0);
    await expect(row(panel).locator(".search-status")).toBeHidden();
    await expect(row(panel).locator('input[type="search"]')).toHaveValue("Springfield, IL");
    await panel.reload();
    await expect(row(panel).locator(".search-results li")).toHaveCount(0);
    await expect(row(panel).locator('input[type="search"]')).toHaveValue("Springfield, IL");
});

test("an empty page, a page that never answers, and Cancel each end the run", async ({ context, extensionId }) => {
    const worker = await workerOf(context);
    await worker.evaluate(() => __intel!.settings!.set("bulk.detectTimeout", 3));
    await context.route("https://listings.example/**", (route) => {
        const url = route.request().url();
        let body: string;
        if (url.includes("/search/nowhere/")) body = `<!doctype html><html><head><title>Nowhere</title></head><body><main data-search="nowhere"><h1>Rentals in Nowhere</h1></main></body></html>`;
        else if (url.includes("/search/blank/")) body = `<!doctype html><html><head><title>Checking</title></head><body><p>Press and hold to prove you are a person.</p></body></html>`;
        else body = fixtureFor(url);
        return route.fulfill({ contentType: "text/html", body });
    });

    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    const site = row(panel);
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();

    // A search page with nothing on it is an answer.
    await site.locator('input[type="search"]').fill("nowhere");
    await site.locator('input[type="search"]').press("Enter");
    await expect(site.locator(".search-status")).toHaveText(/^No results\./, { timeout: 20_000 });
    await expect(site.locator(".search-results")).toBeHidden();
    await expect(page).toHaveURL("https://listings.example/search/nowhere/");

    // A page that never becomes a search page runs out the budget, on which
    // the run waits on the person at the tab rather than giving up; Cancel
    // ends it there and then.
    await site.locator('input[type="search"]').fill("blank");
    await site.locator('input[type="search"]').press("Enter");
    await expect(site.locator('button[data-action="cancel"]')).toHaveText("Cancel");
    await expect(site.locator(".search-status")).toContainText("Nothing yet after 3s", { timeout: 20_000 });
    await expect(site.locator(".search-status")).toContainText("answer it in the tab");
    await expect(page).toHaveURL("https://listings.example/search/blank/");
    await site.locator('button[data-action="cancel"]').click();
    await expect(site.locator(".search-status")).toContainText("Cancelled.");
    await expect(site.locator('button[data-action="run"]')).toHaveText("Search");
});

test("filters are applied on the site once it has found the place; a pasted URL is used as it is", async ({ context, extensionId }) => {
    await serveExampleSite(context);
    const worker = await workerOf(context);
    await worker.evaluate(() => __intel!.settings!.set("search.pace", 0));
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();

    // Folded until asked for; the count of set filters shows either way.
    const site = row(panel);
    const toggle = site.locator(".search-filters-toggle");
    await expect(toggle).toHaveText("+ Filters");
    await expect(site.locator(".search-filters")).toBeHidden();
    await expect(site.locator(".search-filters-reset")).toBeHidden();
    await toggle.click();
    await site.locator('[data-filter="beds"]').selectOption("2");
    await site.locator('[data-filter="rentMax"]').fill("2500");
    await site.locator('[data-filter="rentMax"]').blur();
    await site.locator('[data-filter="pets"]').check();
    await expect(toggle).toHaveText("− Filters (3)");

    // The text is searched first, then the same search is opened with the filters.
    await site.locator('input[type="search"]').fill("Springfield, IL");
    await site.locator('input[type="search"]').press("Enter");
    await expect(site.locator(".search-status")).toContainText("2 results", { timeout: 20_000 });
    await expect(page).toHaveURL("https://listings.example/search/springfield-il/?beds=2&max=2500&pets=1");
    await expect(site.locator(".search-status a")).toHaveAttribute("href", "https://listings.example/search/springfield-il/?beds=2&max=2500&pets=1");

    // The filters are part of what a form remembers.
    await panel.reload();
    await expect(row(panel).locator(".search-filters-toggle")).toHaveText("− Filters (3)");
    await expect(row(panel).locator('[data-filter="beds"]')).toHaveValue("2");
    await expect(row(panel).locator('[data-filter="rentMax"]')).toHaveValue("2500");
    await expect(row(panel).locator('[data-filter="pets"]')).toBeChecked();

    // A URL says what it wants: the filters are left off it.
    await row(panel).locator('input[type="search"]').fill("https://listings.example/search/tacoma/");
    await row(panel).locator('input[type="search"]').press("Enter");
    await expect(row(panel).locator(".search-status")).toContainText("2 results", { timeout: 20_000 });
    await expect(page).toHaveURL("https://listings.example/search/tacoma/");

    // Reset sets none, and the next run is the bare search again.
    await row(panel).locator(".search-filters-reset").click();
    await expect(row(panel).locator(".search-filters-toggle")).toHaveText("− Filters");
    await expect(row(panel).locator('[data-filter="beds"]')).toHaveValue("");
    await expect(row(panel).locator('[data-filter="pets"]')).not.toBeChecked();
    await row(panel).locator('input[type="search"]').fill("Springfield, IL");
    await row(panel).locator('input[type="search"]').press("Enter");
    await expect(row(panel).locator(".search-status")).toContainText("2 results", { timeout: 20_000 });
    await expect(page).toHaveURL("https://listings.example/search/springfield-il/");
});
