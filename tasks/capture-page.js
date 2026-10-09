/**
 * DevTools snippet: downloads the current page's rendered DOM as a raw
 * capture. Run it in a Guest window (no account, fresh cookies) on a listing
 * page; the rendered DOM is what the content script sees, unlike view-source.
 * Drop the file in work/captures/ (gitignored) and run `npm run capture:trim`
 * on it; never commit the raw file, which carries the browser's own ids.
 */
(() => {
    const slug = location.pathname.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-").slice(0, 80) || "page";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${location.hostname.replace(/^www\./, "")}.${slug}.${stamp}.raw.html`;

    const html =
        `<!doctype html>\n<!-- raw capture: ${location.href} at ${new Date().toISOString()} -->\n` +
        document.documentElement.outerHTML;

    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    console.log(`captured ${(html.length / 1024).toFixed(0)} KB -> ${name}`);
})();
