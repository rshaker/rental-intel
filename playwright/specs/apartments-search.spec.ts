import { expect, fixtureHtml, openPanel, test } from "../harness/extension";

/**
 * Searching apartments.com from the Search tab. The site resolves free text
 * through its own search box, so the run opens the home page (the trimmed
 * capture) in the tab beside the panel and the content script drives the
 * box; a script added here stands in for the site's typeahead, drawing the
 * box late and offering an Areas suggestion whose click goes to the results
 * page (the placard fixture). Then a pasted URL that lands on the site's
 * not-found page ends the run at once with the reason, instead of waiting
 * out the budget.
 */

const RESULTS_URL = "https://www.apartments.com/austin-tx-78701/";

/**
 * The site's typeahead, as far as the driver needs it. The box is taken out
 * of the document and put back late, as the live site draws it well after
 * load: the driver's first look finds nothing and it must try again.
 */
const TYPEAHEAD = `<script>
    const section = document.querySelector("#homepage-smart-search");
    const parent = section.parentNode;
    section.remove();
    setTimeout(() => {
        parent.append(section);
        const box = section.querySelector(".smart-search-input");
        const dropdown = section.querySelector(".smart-search-typeahead-dropdown-container");
        box.addEventListener("input", () => {
            setTimeout(() => {
                dropdown.insertAdjacentHTML("beforeend", '<div class="smart-search-category-wrapper"><span class="smart-search-category-title">Areas</span><ul><li class="smart-search-item" data-type="geography">' + box.textContent + ', Austin, TX</li></ul></div>');
                dropdown.querySelector('[data-type="geography"]').addEventListener("click", () => { location.href = "${RESULTS_URL}"; });
            }, 200);
        });
    }, 2500);
</script>`;

const NOT_FOUND = `<!doctype html><html><head><title>404 Page Not Found</title></head><body><h1>Can we help you get somewhere else?</h1></body></html>`;

/** Serves the site: the home page with the given typeahead, the results page, and 404 for the rest. */
async function serveSite(context: import("@playwright/test").BrowserContext, typeahead: string): Promise<void> {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    const home = fixtureHtml("apartments-home.html").replace("</body>", `${typeahead}</body>`);
    const results = fixtureHtml("apartments-search.html");
    await context.route("https://www.apartments.com/**", (route) => {
        const url = route.request().url();
        const path = new URL(url).pathname;
        const body = path === "/" ? home : url === RESULTS_URL ? results : NOT_FOUND;
        route.fulfill({ status: body === NOT_FOUND ? 404 : 200, contentType: "text/html", body });
    });
    await context.route("https://images1.apartments.com/**", (route) => route.fulfill({ status: 404 }));
}

test("free text is typed into the site's own box, and its suggestion leads to the results in the tab beside the panel", async ({ context, extensionId }) => {
    await serveSite(context, TYPEAHEAD);
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();
    const site = panel.locator('.search-row[data-source="apartments"]');
    await site.locator('input[type="search"]').fill("78701");
    await site.locator('input[type="search"]').press("Enter");

    await expect(site.locator(".search-status")).toContainText("1 result", { timeout: 30_000 });
    const links = site.locator(".search-results li a");
    await expect(links).toHaveText(["The Juniper Lofts"]);
    await expect(links.first()).toHaveAttribute("href", "https://www.apartments.com/the-juniper-lofts-austin-tx/k4m2x9z/");
    await expect(site.locator(".search-status a")).toHaveAttribute("href", RESULTS_URL);
    await expect(page).toHaveURL(RESULTS_URL);
    expect(context.pages().filter((p) => p.url().includes("apartments.com"))).toHaveLength(1);
});

test("a search whose results run over pages is walked through them, and the lists are joined", async ({ context, extensionId }) => {
    if (context.serviceWorkers().length === 0) await context.waitForEvent("serviceworker");
    const first = "https://www.apartments.com/austin-tx/";
    const second = "https://www.apartments.com/austin-tx/2/";
    const results = fixtureHtml("apartments-search.html");
    // Page two repeats page one's listing, as the site's paid tiers do, and adds another.
    const more = `<article class="placard" data-listingid="1a2b3c4d"><a class="property-link" href="https://www.apartments.com/the-yesler-austin-tx/k3m9x2p/">The Yesler</a><p class="property-pricing">$1,500</p></article>`;
    const pages: Record<string, string> = {
        [first]: results.replace("</main>", `<nav id="paging" class="paging"><ol><li><a class="active">1</a></li><li><a class="next" href="${second}">Next</a></li></ol></nav></main>`),
        [second]: results.replace("</article>", `</article>${more}`).replace("</main>", `<nav id="paging" class="paging"><ol><li><a class="previous" href="${first}">Prev</a></li><li><a class="active">2</a></li></ol></nav></main>`),
    };
    await context.route("https://www.apartments.com/**", (route) => {
        const body = pages[route.request().url()];
        route.fulfill({ status: body ? 200 : 404, contentType: "text/html", body: body ?? NOT_FOUND });
    });
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();
    const site = panel.locator('.search-row[data-source="apartments"]');
    await site.locator('input[type="search"]').fill(first);
    await site.locator('input[type="search"]').press("Enter");

    await expect(site.locator(".search-status")).toContainText("2 results from 2 pages", { timeout: 30_000 });
    await expect(site.locator(".search-results li a")).toHaveText(["The Juniper Lofts", "The Yesler"]);
    await expect(site.locator(".search-status a")).toHaveAttribute("href", first);
    await expect(page).toHaveURL(second);
});

test("a pasted URL that the site has no page for ends the run with the reason", async ({ context, extensionId }) => {
    await serveSite(context, TYPEAHEAD);
    const panel = await openPanel(context, extensionId, 0);
    await panel.locator('.tabs button[data-tab="search"]').click();
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.bringToFront();
    const site = panel.locator('.search-row[data-source="apartments"]');
    await site.locator('input[type="search"]').fill("https://www.apartments.com/78701/");
    await site.locator('input[type="search"]').press("Enter");

    await expect(site.locator(".search-status")).toContainText("no page at that address", { timeout: 10_000 });
    await expect(site.locator(".search-status")).toHaveClass(/bad/);
    await expect(page).toHaveURL("https://www.apartments.com/78701/");
});
