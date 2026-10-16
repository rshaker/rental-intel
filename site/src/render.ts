import {
    ALL_SLUG,
    addressText,
    availableText,
    bedsRange,
    bedsWord,
    factsText,
    hasCats,
    hasLaundryInUnit,
    listingUrl,
    money,
    NEIGHBORHOODS,
    PAGES_ORIGIN,
    photoUrl,
    priceText,
    rentRange,
    searchUrl,
    slug,
    streetLine,
    units,
    type SeedListing,
} from "./data/index.js";

/**
 * The pages of the example site as strings. A listing page carries the
 * three things real listing pages carry, JSON-LD, an inline payload and a
 * marked-up DOM, in exactly the shape src/sources/example/page.ts reads;
 * playwright/fixtures/example-*.html are the reference.
 */

export function escape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON safe inside a <script>: no "</" sequence survives. */
function json(value: unknown): string {
    return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

const STYLE = `
    :root { color-scheme: light; --ink: #1f2328; --muted: #6b7280; --line: #e5e7eb; --accent: #2563eb; --bg: #fafafa; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--ink); background: var(--bg); }
    header { background: #fff; border-bottom: 1px solid var(--line); }
    header .bar { max-width: 1080px; margin: 0 auto; padding: 14px 20px; display: flex; gap: 24px; align-items: baseline; flex-wrap: wrap; }
    header .brand { font-weight: 700; font-size: 18px; color: var(--ink); text-decoration: none; }
    header nav a { color: var(--muted); text-decoration: none; margin-right: 14px; font-size: 14px; }
    header nav a:hover { color: var(--accent); }
    main { max-width: 1080px; margin: 0 auto; padding: 24px 20px 48px; }
    footer { max-width: 1080px; margin: 0 auto; padding: 24px 20px; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); }
    h1 { font-size: 28px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 10px; }
    .address, .muted { color: var(--muted); }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; margin: 18px 0; }
    .gallery img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 8px; display: block; }
    table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    th, td { text-align: left; padding: 8px 12px; border-top: 1px solid var(--line); }
    tr[data-plan] th { background: #f3f4f6; }
    tr[data-plan] td { background: #f3f4f6; color: var(--muted); }
    ul.amenities { columns: 2; padding-left: 20px; }
    .facts { display: flex; gap: 18px; flex-wrap: wrap; font-size: 15px; margin: 6px 0 0; }
    .rating { color: #b45309; }
    .results { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
    .results li { display: grid; grid-template-columns: 160px 1fr; gap: 16px; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
    .results img { width: 160px; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 6px; display: block; }
    .results a { font-weight: 600; color: var(--ink); text-decoration: none; font-size: 17px; }
    .results a:hover { color: var(--accent); }
    .results .price { font-weight: 600; margin-top: 2px; }
    .results .line { color: var(--muted); font-size: 14px; }
    form.filters { display: flex; gap: 14px; flex-wrap: wrap; align-items: end; background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 16px 0; font-size: 14px; }
    form.filters label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); }
    form.filters label.check { flex-direction: row; align-items: center; }
    form.filters input, form.filters select { font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; }
    form.filters button { font: inherit; padding: 6px 14px; border: 0; border-radius: 6px; background: var(--accent); color: #fff; }
    .hoods { display: flex; gap: 10px; flex-wrap: wrap; padding: 0; list-style: none; }
    .hoods a { display: inline-block; padding: 8px 14px; background: #fff; border: 1px solid var(--line); border-radius: 999px; color: var(--ink); text-decoration: none; }
    .hero { padding: 40px 0 24px; }
    .hero p { font-size: 18px; color: var(--muted); max-width: 560px; }
    .cta { display: inline-block; margin-top: 8px; padding: 10px 18px; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
`;

interface Layout {
    title: string;
    url: string;
    jsonLd: unknown;
    body: string;
}

function layout({ title, url, jsonLd, body }: Layout): string {
    const nav = [`<a href="${PAGES_ORIGIN}/">Home</a>`, `<a href="${searchUrl(ALL_SLUG)}">All of Austin</a>`, ...NEIGHBORHOODS.slice(0, 6).map((h) => `<a href="${searchUrl(slug(h))}">${escape(h)}</a>`)];
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} | Example Listings</title>
<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">
${json(jsonLd)}
</script>
<style>${STYLE}</style>
</head>
<body>
<header><div class="bar"><a class="brand" href="${PAGES_ORIGIN}/">Example Listings</a><nav>${nav.join("")}</nav></div></header>
${body}
<footer>Example Listings is an invented site for testing Rental Intel. Every listing, address, name and photo on it is fictional.</footer>
</body>
</html>
`;
}

function ldType(l: SeedListing): string {
    if (l.kind === "building") return "ApartmentComplex";
    return l.type === "house" ? "SingleFamilyResidence" : l.type === "condo" ? "Apartment" : "House";
}

function plansTable(l: SeedListing): string {
    if (l.kind === "home") {
        const u = units(l)[0]!;
        return `<table><tr data-unit="${u.id}"><td>${escape(u.name)}</td><td>${bedsWord(u.beds)} / ${u.baths} ba</td><td>${u.sqft.toLocaleString("en-US")} sqft</td><td>${money(u.rent)}</td><td>${escape(availableText(u.available))}</td></tr></table>`;
    }
    const rows: string[] = [];
    for (const p of l.plans) {
        rows.push(`<tr data-plan="${p.id}"><th>${escape(p.name ?? "")}</th><td>${bedsWord(p.beds)}</td><td>${p.baths} ba</td><td></td><td></td></tr>`);
        for (const u of p.units) {
            rows.push(`<tr data-unit="${u.id}"><td>${escape(u.name)}</td><td></td><td>${u.sqft.toLocaleString("en-US")} sqft</td><td>${money(u.rent)}</td><td>${escape(availableText(u.available))}</td></tr>`);
        }
    }
    return `<h2>Floor plans</h2><table>${rows.join("")}</table>`;
}

export function listingPage(l: SeedListing): string {
    const url = listingUrl(l.id);
    const photos = Array.from({ length: l.photoCount }, (_, i) => photoUrl(l.id, i + 1));
    const jsonLd = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "BreadcrumbList",
                itemListElement: [
                    { "@type": "ListItem", position: 1, name: "Austin", item: searchUrl(ALL_SLUG) },
                    { "@type": "ListItem", position: 2, name: l.hood, item: searchUrl(slug(l.hood)) },
                    { "@type": "ListItem", position: 3, name: l.name },
                ],
            },
            {
                "@type": ldType(l),
                identifier: l.id,
                name: l.name,
                url,
                telephone: l.phone,
                address: { "@type": "PostalAddress", streetAddress: streetLine(l), addressLocality: "Austin", addressRegion: "TX", postalCode: l.zip },
                geo: { "@type": "GeoCoordinates", latitude: l.geo.lat, longitude: l.geo.lng },
                image: photos,
            },
        ],
    };
    const payload = {
        id: l.id,
        kind: l.kind,
        type: l.type,
        ...(l.rating !== null ? { rating: l.rating } : {}),
        plans: l.plans.map((p) => ({ id: p.id, name: p.name, beds: p.beds, baths: p.baths, units: p.units.map((u) => ({ id: u.id, name: u.name, beds: u.beds, baths: u.baths, sqft: u.sqft, rent: u.rent, available: u.available })) })),
    };
    const [lo, hi] = rentRange(l);
    const body = `<main data-listing="${l.id}"${l.rating !== null ? ` data-rating="${l.rating}"` : ""}>
<h1 data-field="name">${escape(l.name)}</h1>
<p class="address" data-field="address">${escape(addressText(l))}</p>
<p class="facts"><span>${money(lo)}${lo === hi ? "" : ` – ${money(hi)}`} / mo</span><span>${escape(factsText(l))}</span>${l.rating !== null ? `<span class="rating">★ ${l.rating} / 5</span>` : ""}<span class="muted">${escape(l.phone)}</span></p>
<div class="gallery">${photos.map((p, i) => `<img data-photo src="${p}" alt="Photo ${i + 1} of ${escape(l.name)}">`).join("")}</div>
<section data-field="plans">${plansTable(l)}</section>
<h2>Amenities</h2>
<ul class="amenities" data-field="amenities">${l.amenities.map((a) => `<li>${escape(a)}</li>`).join("")}</ul>
<h2>Pets</h2>
<p data-field="pets">${escape(l.pets)}</p>
<h2>About</h2>
<div data-field="description">${escape(l.description)}</div>
</main>
<script id="listing-data" type="application/json">
${json(payload)}
</script>`;
    return layout({ title: `${l.name} - Austin, TX`, url, jsonLd, body });
}

/** The filters in the query string, applied as the page parses: non-matching rows are removed, so a reader sees only matches. */
const FILTER_SCRIPT = `<script>(function(){
var q=new URLSearchParams(location.search);var beds=q.get("beds"),max=q.get("max"),cats=q.get("cats")==="1",laundry=q.get("laundry")==="1",kw=(q.get("kw")||"").toLowerCase().split(/\\s+/).filter(Boolean);
var rows=document.querySelectorAll("[data-result]"),kept=0;
rows.forEach(function(r){var ok=true;
if(beds&&Number(r.dataset.beds)<Number(beds))ok=false;
if(max&&Number(r.dataset.rent)>Number(max))ok=false;
if(cats&&r.dataset.cats!=="1")ok=false;
if(laundry&&r.dataset.laundry!=="1")ok=false;
if(kw.length){var t=r.textContent.toLowerCase();if(!kw.every(function(w){return t.indexOf(w)>=0;}))ok=false;}
if(ok)kept++;else r.remove();});
var c=document.querySelector("[data-count]");if(c)c.textContent=kept+(kept===1?" rental":" rentals");
var f=document.querySelector("form.filters");if(f){if(beds)f.beds.value=beds;if(max)f.max.value=max;f.cats.checked=cats;f.laundry.checked=laundry;f.kw.value=q.get("kw")||"";}
})();</script>`;

function featureLine(l: SeedListing): string {
    const features = l.amenities.filter((a) => /laundry|dishwasher|parking|fitness|pool/i.test(a));
    return [l.hood, addressText(l), ...features].join(" · ");
}

export function searchPage(slugText: string, heading: string, rows: readonly SeedListing[]): string {
    const url = searchUrl(slugText);
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: rows.map((l, i) => ({ "@type": "ListItem", position: i + 1, item: { "@type": ldType(l), identifier: l.id, name: l.name, url: listingUrl(l.id) } })),
    };
    const items = rows.map((l) => {
        const [lo] = rentRange(l);
        const [, maxBeds] = bedsRange(l);
        return `<li data-result data-kind="${l.kind}" data-beds="${maxBeds}" data-rent="${lo}" data-cats="${hasCats(l) ? 1 : 0}" data-laundry="${hasLaundryInUnit(l) ? 1 : 0}">
<img data-photo src="${photoUrl(l.id, 1)}" alt="">
<div><a href="${listingUrl(l.id)}">${escape(l.name)}</a><div class="price"><span data-field="price">${escape(priceText(l))}</span> <span class="muted">· <span data-field="facts">${escape(factsText(l))}</span></span></div><div class="line">${escape(featureLine(l))}</div></div>
</li>`;
    });
    const body = `<main data-search="${slugText}">
<h1>Rentals in ${escape(heading)}</h1>
<form class="filters" method="get" action="${url}">
<label>Bedrooms<select name="beds"><option value="">Any</option><option value="0">Studio+</option><option value="1">1+</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option></select></label>
<label>Max rent<input name="max" type="number" min="0" step="50" placeholder="$"></label>
<label class="check"><input name="cats" type="checkbox" value="1"> Cats</label>
<label class="check"><input name="laundry" type="checkbox" value="1"> In-unit laundry</label>
<label>Keywords<input name="kw" type="search" placeholder="pool, yard, …"></label>
<button type="submit">Search</button>
</form>
<p class="muted" data-count>${rows.length} rentals</p>
<ul class="results">
${items.join("\n")}
</ul>
${FILTER_SCRIPT}
</main>`;
    return layout({ title: `Rentals in ${heading}`, url, jsonLd, body });
}

export function homePage(count: number): string {
    const url = `${PAGES_ORIGIN}/`;
    const jsonLd = { "@context": "https://schema.org", "@type": "WebSite", name: "Example Listings", url };
    const body = `<main>
<div class="hero"><h1>Rentals in Austin, TX</h1><p>${count} apartments, condos and houses for rent across the city. Every one of them is made up.</p><a class="cta" href="${searchUrl(ALL_SLUG)}">Browse all rentals</a></div>
<h2>By neighborhood</h2>
<ul class="hoods">${NEIGHBORHOODS.map((h) => `<li><a href="${searchUrl(slug(h))}">${escape(h)}</a></li>`).join("")}</ul>
</main>`;
    return layout({ title: "Rentals in Austin, TX", url, jsonLd, body });
}

export function notFoundPage(): string {
    const url = `${PAGES_ORIGIN}/404`;
    const body = `<main><h1>Not found</h1><p class="muted">There is no such page on Example Listings.</p><p><a href="${searchUrl(ALL_SLUG)}">Browse all rentals</a></p></main>`;
    return layout({ title: "Not found", url, jsonLd: { "@context": "https://schema.org", "@type": "WebPage", name: "Not found" }, body });
}
