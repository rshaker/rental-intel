/**
 * Turns a raw page capture into a committable fixture, and lays the site's
 * payloads out for reading.
 *
 *   npm run capture:trim -- --source apartments work/captures/<name>.raw.html playwright/fixtures/apartments-building.html
 *
 * Writes:
 *   <fixture>            trimmed + scrubbed HTML, safe to commit
 *   work/captures/<fixture>.state.json
 *                        every payload block parsed and pretty-printed, for analysis
 *
 * What is kept is decided by the source's capture profile
 * (src/sources/<id>/capture.profile.mjs): which script blocks are payloads,
 * which elements are interesting, which attributes survive, which image
 * hosts count. The rest of the page -- styles, scripts, decoration, text
 * outside the interesting elements -- is dropped.
 *
 * What survives regardless, and why:
 *   head:  <title>, canonical, og:* meta, ld+json -- the probes read these
 *          on every site.
 *   body:  the *skeleton*: any element whose subtree holds an interesting
 *          element, with the other attributes stripped. Nesting is kept so
 *          selectors like '[data-field=plans] tr' still match.
 *
 * Scrubbing, in three layers, because a fixture ships with the repository:
 *   1. object keys in the payloads that look like account context (email,
 *      token, session, csrf, cookie, phone, guid, ...) are redacted;
 *   2. the serialised output is swept for the shapes that live outside
 *      JSON keys -- Zillow account ids (X1-ZU…), analytics ids assigned in
 *      inline scripts (anonymousId, customDimension1, cs_fpid, identify),
 *      tracking-pixel query ids (Bing sid/vid/mid, Teads user_session_id,
 *      screen size), Google API keys -- and tracking <img> beacons and
 *      "recent searches" history rows are dropped from the DOM;
 *   3. the script REFUSES to write when the page was captured logged in,
 *      when the git user's email survives, or when any line of the optional
 *      work/captures/denylist.txt (your own ids, addresses, zips; one per
 *      line, gitignored) survives.
 * Capture in a Guest window (tasks/capture-page.js). Still read a trimmed
 * fixture before committing it.
 */
import { JSDOM } from "jsdom";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURES = resolve(ROOT, "work", "captures");

// -- arguments ----------------------------------------------------------------

const args = process.argv.slice(2);
let sourceId = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source") sourceId = args[++i];
    else positional.push(args[i]);
}
const [rawPath, fixturePath] = positional;
if (!sourceId || !rawPath || !fixturePath) {
    console.error("usage: npm run capture:trim -- --source <id> <raw.html> <fixture.html>");
    process.exit(2);
}
const profilePath = resolve(ROOT, "src", "sources", sourceId, "capture.profile.mjs");
if (!existsSync(profilePath)) {
    console.error(`no capture profile for source "${sourceId}": expected ${profilePath}`);
    process.exit(2);
}
const profile = (await import(pathToFileURL(profilePath).href)).default;
const keepAttrs = new Set(profile.keepAttrs ?? []);
const keepDataAttrs = keepAttrs.has("data-*");

const REDACT_KEY = /email|token|session|csrf|cookie|phone|password|secret|auth|userid|user_id|guid|visitor/i;
const KEYS_OF_INTEREST = profile.keysOfInterest ?? /^$/;

const raw = readFileSync(rawPath, "utf8");
const dom = new JSDOM(raw);
const { document } = dom.window;
const sourceUrl = /<!-- raw capture: (\S+) /.exec(raw)?.[1] ?? document.querySelector('link[rel="canonical"]')?.href ?? "(unknown)";

// -- payloads: parse, unwrap, redact ------------------------------------------

/** Some sites double-encode: a JSON string inside JSON. Unwrap for reading. */
function unwrap(value) {
    if (Array.isArray(value)) return value.map(unwrap);
    if (typeof value === "string" && value.length > 64 && /^[[{]/.test(value.trim())) {
        try {
            return unwrap(JSON.parse(value));
        } catch {
            return value;
        }
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
    }
    return value;
}

let redactions = 0;
/** Redacts by key name, reaching inside double-encoded JSON strings and re-encoding them so the fixture keeps the site's shape. */
function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (typeof value === "string" && value.length > 64 && /^[[{]/.test(value.trim())) {
        try {
            return JSON.stringify(redact(JSON.parse(value)));
        } catch {
            return value;
        }
    }
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
        Object.entries(value).map(([k, v]) => {
            if (REDACT_KEY.test(k) && (typeof v === "string" || typeof v === "number")) {
                redactions += 1;
                return [k, "[redacted]"];
            }
            return [k, redact(v)];
        }),
    );
}

/** Every path in `value` whose last key matches, with a short preview. */
function findPaths(value, out = [], path = "$", depth = 0) {
    if (out.length >= 80 || depth > 25) return out;
    if (Array.isArray(value)) {
        value.slice(0, 3).forEach((item, i) => findPaths(item, out, `${path}[${i}]`, depth + 1));
        return out;
    }
    if (typeof value !== "object" || value === null) return out;
    for (const [k, v] of Object.entries(value)) {
        const here = /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}["${k.slice(0, 40)}"]`;
        if (KEYS_OF_INTEREST.test(k)) {
            const preview =
                typeof v === "object" && v !== null
                    ? Array.isArray(v)
                        ? `[${v.length} items]`
                        : `{${Object.keys(v).slice(0, 6).join(", ")}${Object.keys(v).length > 6 ? ", …" : ""}}`
                    : JSON.stringify(v)?.slice(0, 60);
            out.push(`${here} = ${preview}`);
        }
        findPaths(v, out, here, depth + 1);
    }
    return out;
}

const blobs = [];
for (const selector of profile.payloadSelectors ?? []) {
    for (const script of document.querySelectorAll(selector)) {
        if (blobs.some((b) => b.node === script)) continue;
        const text = script.textContent?.trim();
        if (!text) continue;
        try {
            const redacted = redact(JSON.parse(text));
            blobs.push({ node: script, id: script.id || selector, parsed: unwrap(redacted), bytes: text.length });
            if (profile.payloadKeep && !profile.payloadKeep.test(text)) {
                script.remove();
                continue;
            }
            // Escape `<` as JSON `<`: a payload can embed HTML, and a
            // literal `</script>` inside the JSON would end the element early
            // when the fixture is parsed.
            script.textContent = JSON.stringify(redacted).replace(/</g, "\\u003c");
        } catch {
            // Not JSON we can read; leave it out of the fixture rather than guess.
            script.remove();
        }
    }
}

// -- head: keep only what the probes read --------------------------------------

for (const node of [...document.head.children]) {
    const keep =
        node.matches("title") ||
        node.matches('link[rel="canonical"]') ||
        node.matches('meta[property^="og:"]') ||
        node.matches('script[type="application/ld+json"]') ||
        blobs.some((b) => b.node === node);
    if (!keep) node.remove();
}

// -- body: the skeleton ---------------------------------------------------------

const imageSelector = (profile.imageHosts ?? []).map((host) => `img[src*='${host}'], img[data-src*='${host}']`).join(", ");
const INTERESTING = [profile.interesting, imageSelector, "script[type='application/ld+json']", ...(profile.payloadSelectors ?? [])].filter(Boolean).join(", ");

// JSON-LD stays wherever the site put it (apartments.com writes it in the body).
for (const node of document.body.querySelectorAll("script, style, svg, iframe, noscript, template, link")) {
    if (!blobs.some((b) => b.node === node) && !node.matches('script[type="application/ld+json"]')) node.remove();
}
// Site furniture the profile names as never wanted: promotional placards on a
// home page, "nearby" carousels -- whatever would read as listings or places
// without being the page's subject.
for (const node of profile.drop ? document.body.querySelectorAll(profile.drop) : []) node.remove();

/**
 * Prunes subtrees with nothing interesting in them; returns whether `el`
 * survives. Inside an element the profile names in `keepTextWithin`, every
 * element with text survives too: sites nest a value two or three plain
 * wrappers below the element that names it, and the value is the point.
 */
const KEEP_TEXT_WITHIN = profile.keepTextWithin ?? null;
function prune(el, insideTextKeeper = false) {
    const self = el.matches(INTERESTING);
    const keeper = insideTextKeeper || (KEEP_TEXT_WITHIN !== null && el.matches(KEEP_TEXT_WITHIN));
    let anyChild = false;
    for (const child of [...el.children]) anyChild = prune(child, keeper) || anyChild;
    const hasText = keeper && (el.textContent ?? "").trim() !== "";
    if (!self && !anyChild && !hasText) {
        el.remove();
        return false;
    }
    // Text that belongs to an interesting element is data; text elsewhere is not.
    if (!self && !keeper) for (const n of [...el.childNodes]) if (n.nodeType === 3) n.remove();
    if (el.matches("script")) return true; // its attributes and JSON body are the point
    for (const attr of [...el.attributes]) {
        const wanted = keepAttrs.has(attr.name) || (keepDataAttrs && attr.name.startsWith("data-"));
        if (!wanted) el.removeAttribute(attr.name);
    }
    return true;
}
for (const child of [...document.body.children]) prune(child);
for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
for (const attr of [...document.documentElement.attributes]) if (attr.name !== "lang") document.documentElement.removeAttribute(attr.name);

// -- JSON-LD: keep the listing, drop the people ---------------------------------

// A site's structured data can carry its reviews: reviewer names and what
// they wrote. Third parties' data, and nothing a probe reads. The aggregate
// rating stays.
const LD_DROP_KEYS = /^(review|reviews|author|creator|employee|employees|founder|founders)$/i;
let ldDropped = 0;
function stripLd(value) {
    if (Array.isArray(value)) return value.map(stripLd);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(
        Object.entries(value).flatMap(([k, v]) => {
            if (LD_DROP_KEYS.test(k)) {
                ldDropped += 1;
                return [];
            }
            return [[k, stripLd(v)]];
        }),
    );
}
for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
        script.textContent = JSON.stringify(stripLd(JSON.parse(script.textContent))).replace(/</g, "\\u003c");
    } catch {
        script.remove(); // malformed: not worth keeping
    }
}

// -- tracking furniture: beacons and the visitor's own history -------------------

// An <img> that is not a photo is a pixel: its URL carries visitor ids.
const imageHosts = profile.imageHosts ?? [];
let beacons = 0;
for (const img of [...document.querySelectorAll("img")]) {
    const src = img.getAttribute("src") ?? img.getAttribute("data-src") ?? "";
    if (!imageHosts.some((host) => src.includes(host))) {
        img.remove();
        beacons += 1;
    }
}
// apartments.com's search box lists the profile's recent searches as rows; the capturing browser's, not the site's.
let history = 0;
for (const row of [...document.querySelectorAll('[data-type="history"]')]) {
    row.remove();
    history += 1;
}

// -- scrub check and output ------------------------------------------------------

let email = "";
try {
    email = execSync("git config user.email", { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
    // No git identity; the other checks are all we can do.
}

const header =
    `<!doctype html>\n<!--\n  CAPTURED fixture -- trimmed from a real ${sourceId} page by tasks/trim-capture.mjs.\n` +
    `  Source: ${sourceUrl}\n  Captured: ${new Date().toISOString().slice(0, 10)}, in a Guest window (no account)\n\n` +
    `  Head holds the metadata and payloads the probes read; body is the skeleton\n` +
    `  of every interesting element (see the source's capture.profile.mjs) with\n` +
    `  decoration removed. Account and browser ids were redacted by key name and\n` +
    `  by shape; tracking pixels were dropped. Re-run the script on the raw\n` +
    `  capture in work/captures/ rather than editing this by hand.\n-->\n`;
let html = header + document.documentElement.outerHTML + "\n";

/**
 * Ids that live outside JSON keys: assigned in inline scripts, or riding in
 * pixel URLs. Each pattern keeps the key and replaces the value, so the
 * fixture keeps the site's shape. Applied to the serialised page, which
 * also reaches inside double-encoded payload strings.
 */
const VALUE_SCRUBS = [
    // Zillow account ids, wherever they appear (viewerId, uid, cs_fpid, identify(...), customDimension1).
    [/X1-ZU[\w-]+/g, "[redacted]"],
    // Analytics ids assigned by inline scripts: anonymousId: 'uuid', randomizationKey":"hex32", customDimension1 = 'hex32/…'.
    [/((?:anonymousId|randomizationKey|customDimension1|cs_fpid|viewerId|clientId|visitorId|deviceId)\\?["']?\s*[:=]\s*\\?["'])([^"'\\]+)/g, "$1[redacted]"],
    [/(identify\(\s*["'])([^"']+)/g, "$1[redacted]"],
    // Pixel URLs: Bing sid/vid/mid, Teads user_session_id, the screen size.
    [/([?&](?:amp;)?(?:sid|vid|mid|user_session_id|uid|cid|_ga|fbp)=)[\w.-]+/g, "$1[redacted]"],
    [/([?&](?:amp;)?s[wh]=)\d+/g, "$10"],
    // Google API keys (the site's own, but secret scanners flag them).
    [/AIza[0-9A-Za-z_-]{35}/g, "[redacted-key]"],
];
let shapeRedactions = 0;
for (const [pattern, replacement] of VALUE_SCRUBS) {
    html = html.replace(pattern, (...match) => {
        shapeRedactions += 1;
        return replacement.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? "");
    });
}

const refusals = [];
if (/"isLoggedIn"\s*:\s*true|\\"isLoggedIn\\"\s*:\s*true|loggedIn\s*:\s*true|"loggedIn"\s*:\s*true/.test(html)) {
    refusals.push("the page was captured while logged in (isLoggedIn/loggedIn is true); capture again in a Guest window");
}
if (email && html.toLowerCase().includes(email.toLowerCase())) refusals.push(`fixture still contains ${email}`);
const denylistPath = resolve(CAPTURES, "denylist.txt");
if (existsSync(denylistPath)) {
    const lower = html.toLowerCase();
    for (const line of readFileSync(denylistPath, "utf8").split("\n")) {
        const term = line.trim();
        if (term && !term.startsWith("#") && lower.includes(term.toLowerCase())) refusals.push(`fixture still contains denylisted "${term}"`);
    }
}
if (refusals.length) {
    console.error(`REFUSING to write ${fixturePath}:`);
    for (const reason of refusals) console.error(`  - ${reason}`);
    console.error("Find each in the raw capture and extend REDACT_KEY or VALUE_SCRUBS, or edit work/captures/denylist.txt if a term is a false alarm.");
    process.exit(1);
}

mkdirSync(dirname(resolve(fixturePath)), { recursive: true });
writeFileSync(fixturePath, html);

mkdirSync(CAPTURES, { recursive: true });
const statePath = resolve(CAPTURES, basename(fixturePath).replace(/\.html$/, "") + ".state.json");
writeFileSync(statePath, JSON.stringify(blobs.map(({ id, parsed }) => ({ id, parsed })), null, 2));

// -- analysis --------------------------------------------------------------------

const ids = [...new Set([...document.body.querySelectorAll("[id]")].map((el) => el.id))];
const dataAttrs = [...new Set([...document.body.querySelectorAll("*")].flatMap((el) => [...el.attributes].map((a) => a.name).filter((n) => n.startsWith("data-"))))];
console.log(`source     ${sourceUrl}`);
console.log(`fixture    ${fixturePath}  (${(html.length / 1024).toFixed(0)} KB, from ${(raw.length / 1024).toFixed(0)} KB)`);
console.log(`payload    ${statePath}`);
console.log(`redacted   ${redactions} value(s) by key name, ${shapeRedactions} by shape; dropped ${beacons} pixel(s), ${history} history row(s), ${ldDropped} JSON-LD people/review node(s)`);
console.log(`canonical  ${document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "(none)"}`);
console.log(`og:url     ${document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? "(none)"}`);
console.log(
    `ld+json    ${
        [...document.querySelectorAll('script[type="application/ld+json"]')]
            .map((s) => {
                try {
                    const parsed = JSON.parse(s.textContent);
                    const nodes = [parsed].flat().flatMap((n) => (n && n["@graph"] ? [n, ...n["@graph"]] : [n]));
                    return nodes.map((n) => [n?.["@type"]].flat().join("/")).join(", ");
                } catch {
                    return "(malformed)";
                }
            })
            .join(" | ") || "(none)"
    }`,
);
console.log(`h1         ${[...document.querySelectorAll("h1")].map((h) => JSON.stringify(h.textContent.trim().slice(0, 60))).join(", ") || "(none)"}`);
console.log(`ids        ${ids.length ? ids.slice(0, 40).join(", ") + (ids.length > 40 ? ", …" : "") : "(none)"}`);
console.log(`data-*     ${dataAttrs.length ? dataAttrs.slice(0, 40).join(", ") + (dataAttrs.length > 40 ? ", …" : "") : "(none)"}`);
for (const blob of blobs) {
    const keys = typeof blob.parsed === "object" && blob.parsed !== null ? Object.keys(blob.parsed) : [];
    console.log(`\npayload <script id="${blob.id}"> (${(blob.bytes / 1024).toFixed(0)} KB), top-level keys: ${keys.slice(0, 20).join(", ")}`);
    const paths = findPaths(blob.parsed);
    console.log(paths.length ? paths.map((p) => "  " + p).join("\n") : "  (no keys of interest found)");
}
