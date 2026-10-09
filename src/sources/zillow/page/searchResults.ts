import type { SearchResult } from "../../contract";
import { text, texts } from "../../shared/dom";
import { factsText } from "../../shared/search";
import { clean, list, num, rangeText, record, str } from "../../shared/values";
import { ZILLOW_ORIGIN, zillowUrls } from "../urls";

/**
 * The result list of a Zillow search page.
 *
 * Zillow renders the list from the same hydration payload its listing pages
 * use (`__NEXT_DATA__`, see hydration.ts), under
 * `searchPageState.cat1.searchResults.listResults`; the helper's
 * `__intel_zillow_state` element carries the same after an in-page move.
 * The exact path is not relied on: the first `listResults` array anywhere
 * in the payload is the list. The property cards in the DOM are the
 * fallback for a page whose payload is not there or not yet filled.
 *
 * UNVERIFIED against a captured search page: the field names below are the
 * ones Zillow's search payload has carried for years (zpid, detailUrl,
 * address, price, unformattedPrice, beds, baths, area), and every one is
 * optional. The first trimmed capture (playwright/fixtures/
 * zillow-search-results.html) is what pins them.
 *
 * Cached per script element against its text: the panel asks every few
 * hundred milliseconds while a run waits, and the payload is a megabyte.
 */

const PAYLOAD_SELECTORS = ["script#__intel_zillow_state", "script#__NEXT_DATA__"];

const read = new WeakMap<Element, { text: string; results: SearchResult[] | null }>();

export function readSearchResults(doc: Document): SearchResult[] | null {
    for (const selector of PAYLOAD_SELECTORS) {
        for (const script of doc.querySelectorAll(selector)) {
            const results = payloadResults(script);
            if (results) return results;
        }
    }
    return domResults(doc);
}

function payloadResults(script: Element): SearchResult[] | null {
    const text = script.textContent?.trim() ?? "";
    if (!text) return null;
    const cached = read.get(script);
    if (cached && cached.text === text) return cached.results;
    let results: SearchResult[] | null = null;
    try {
        const items = findListResults(JSON.parse(text));
        if (items) results = items.map(resultFrom).filter((r): r is SearchResult => r !== null);
    } catch {
        // Not JSON, or not JSON we understand.
    }
    read.set(script, { text, results });
    return results;
}

/** Breadth-first, the first `listResults` array in the payload. */
function findListResults(root: unknown): unknown[] | null {
    const queue: unknown[] = [root];
    while (queue.length) {
        const value = queue.shift();
        if (typeof value !== "object" || value === null) continue;
        if (Array.isArray(value)) {
            queue.push(...value);
            continue;
        }
        const node = value as Record<string, unknown>;
        const items = node["listResults"];
        if (Array.isArray(items)) return items;
        queue.push(...Object.values(node));
    }
    return null;
}

/** One list item as a result; null for one without a page of its own. */
function resultFrom(item: unknown): SearchResult | null {
    const node = record(item);
    if (!node) return null;
    const detailUrl = str(node["detailUrl"]);
    if (!detailUrl) return null;
    let url: string;
    try {
        url = new URL(detailUrl, ZILLOW_ORIGIN).href;
    } catch {
        return null;
    }
    const info = record(node["hdpData"]) ? record(record(node["hdpData"])!["homeInfo"]) : null;
    const { address, name } = addressAndName(node);
    const title = address ?? name ?? str(info?.["streetAddress"]) ?? url;
    const priceText = str(node["price"]) ?? str(node["minPrice"]);
    const price = num(node["unformattedPrice"]) ?? num(info?.["price"]) ?? rangeText(priceText).min;
    const beds = num(node["beds"]) ?? num(node["minBeds"]) ?? num(info?.["bedrooms"]);
    const baths = num(node["baths"]) ?? num(node["minBaths"]) ?? num(info?.["bathrooms"]);
    const sqft = num(node["area"]) ?? num(info?.["livingArea"]);
    // The row is headed by the address; the name, when the site gives one, ends the facts.
    const facts = [factsText(beds, baths, sqft), name && name !== title ? name : null].filter(Boolean).join(" · ") || null;
    return { title, url, priceText, price, factsText: facts, ref: zillowUrls.parse(url) };
}

/**
 * The address alone, and the name the site put in front of it. A building's
 * `address` is its street and city ("1800 Lavaca St, Austin, TX") with
 * the name in `buildingName`; a unit listed on its own has the building's
 * name, and sometimes its advertising, run into the front of `address`
 * ("The Arbor, 1800 Lavaca St #503, Austin, TX 78701") and the street by
 * itself in `addressStreet`. Checked against the live site, 2026-10-03.
 */
function addressAndName(node: Record<string, unknown>): { address: string | null; name: string | null } {
    const full = clean(str(node["address"]));
    const street = clean(str(node["addressStreet"]));
    const zip = str(node["addressZipcode"]);
    let name = clean(str(node["buildingName"]));
    let address = full;
    if (full) {
        const split = splitName(full, street);
        address = split.address;
        name ??= split.name;
    } else if (street) {
        const region = [str(node["addressState"]), zip].filter(Boolean).join(" ");
        address = [street, str(node["addressCity"]), region].filter(Boolean).join(", ");
    }
    if (address && zip && /,\s*[A-Z]{2}$/.test(address)) address = `${address} ${zip}`;
    return { address, name };
}

/**
 * "The Arbor, 1800 Lavaca St #503, Austin, TX 78701" as the address and the
 * name before it. The address starts where the known street does; without
 * one, at the first comma-separated part that starts with a number. Text
 * with neither is left whole, as the address.
 */
export function splitName(text: string, street: string | null = null): { address: string; name: string | null } {
    let at = street ? text.indexOf(street) : -1;
    if (at < 0) {
        const parts = text.split(/,\s*/);
        const first = parts.findIndex((part) => /^\d/.test(part));
        at = first > 0 ? text.indexOf(parts[first]!, parts.slice(0, first).join(", ").length) : 0;
    }
    if (at <= 0) return { address: text, name: null };
    return { address: text.slice(at), name: clean(text.slice(0, at).replace(/[\s,|]+$/, "")) };
}

/** The property cards, for a page whose payload is missing or empty. */
function domResults(doc: Document): SearchResult[] | null {
    const cards = [...doc.querySelectorAll('[data-test="property-card"], [data-testid="property-card"], article[id^="zpid_"]')];
    if (cards.length === 0) return null;
    const results: SearchResult[] = [];
    for (const card of cards) {
        const link = card.querySelector<HTMLAnchorElement>('a[data-test="property-card-link"], a[href*="_zpid"], a[href*="/apartments/"], a[href*="/b/"]');
        const href = link?.getAttribute("href");
        if (!link || !href) continue;
        let url: string;
        try {
            url = new URL(href, ZILLOW_ORIGIN).href;
        } catch {
            continue;
        }
        const written = text(card, "address") ?? clean(link.textContent);
        const { address, name } = written ? splitName(written) : { address: null, name: null };
        const title = address ?? url;
        const priceText = text(card, '[data-test="property-card-price"], [data-testid="property-card-price"]');
        const facts = clean([...texts(card, "ul li"), name].filter(Boolean).join(" · "));
        results.push({ title, url, priceText, price: rangeText(priceText).min, factsText: facts, ref: zillowUrls.parse(url) });
    }
    return results;
}
