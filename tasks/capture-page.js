/**
 * DevTools snippet: download the current page's DOM as a raw capture.
 *
 * Run this in a GUEST window of your everyday Chrome (profile menu > Open
 * Guest profile) on a listing page you can see. A Guest window has no
 * account and fresh cookies, so the capture carries no identity of yours,
 * yet it is still a real browser, which the sites accept after at most one
 * bot check (a fresh dev browser gets treated as a bot by every listing
 * site). Paste the snippet into the DevTools console and press Enter.
 *
 * Why the DOM and not "Save as": the content script runs at document_idle
 * over the *rendered* document. That is what detection and extraction see,
 * so that is what a fixture must hold. `view-source:` shows the server's
 * HTML instead, which differs after any client-side rendering.
 *
 * The download is the whole page, often several MB, and carries the
 * browser's own ids in the site's payloads even from a Guest window. Drop
 * it in work/captures/ (gitignored) and run `npm run capture:trim` on it --
 * never commit the raw file.
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
