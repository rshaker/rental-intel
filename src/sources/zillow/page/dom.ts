import type { Address, CoreFields } from "../../../db/types";
import { emptyCore, rangeOf } from "../../../db/types";
import { text, texts } from "../../shared/dom";
import { clean, num } from "../../shared/values";
import type { ZillowDetail } from "../types";
import { zillowUrls, ZILLOW_ORIGIN } from "../urls";
import { emptyDetail } from "./fields";

/**
 * Reading a Zillow page from its layout, for when the payload is missing or
 * describes another listing. Thinner than the payload -- no coordinates, no
 * fees, no unit list -- but every field a person sees on the page. Verified
 * against a captured home page (October 2026).
 *
 * What the page has, and where:
 *   [data-testid="price"]                      "$1,150/mo"
 *   h1                                          "710 E Dean Keeton St, # 111, Austin, TX 78705"
 *   [data-testid="bed-bath-sqft-fact-container"]  two spans: a value and its label ("1", "beds")
 *   [data-testid="description"]                 the listing's own words
 *   a[href^="/b/"]                              a breadcrumb to the building's page
 *   photos.zillowstatic.com images              the gallery, each photo at several sizes
 */

export const PHOTO_HOST = "photos.zillowstatic.com";

/** "710 E Dean Keeton St, # 111, Austin, TX 78705" in parts. Zillow writes the unit as its own segment. */
export function addressFromHeading(heading: string | null): Address {
    const empty: Address = { line1: null, unit: null, city: null, state: null, zip: null, text: null };
    const value = clean(heading?.replace(/ /g, " "));
    if (!value) return empty;
    const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
    let line1 = parts[0] ?? null;
    let unit: string | null = null;
    let rest = parts.slice(1);
    // A segment like "# B", "APT 101" or "Unit 4" is the unit, not the city.
    if (rest[0] && /^(#|apt\b|unit\b|suite\b|ste\b)/i.test(rest[0])) {
        unit = rest[0].replace(/^(#|apt\.?|unit|suite|ste\.?)\s*/i, "").trim() || null;
        rest = rest.slice(1);
    } else if (line1) {
        const inline = /\s(?:#|apt\.?|unit)\s*([\w-]+)$/i.exec(line1);
        if (inline) {
            unit = inline[1]!;
            line1 = line1.slice(0, inline.index).trim();
        }
    }
    const city = rest[0] ?? null;
    const stateZip = rest[1] ?? null;
    const match = stateZip ? /^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(stateZip) : null;
    return {
        line1,
        unit,
        city,
        state: match ? match[1]! : stateZip,
        zip: match ? match[2]! : null,
        text: value,
    };
}

/**
 * One URL per gallery photo, at its largest size. Zillow serves each photo
 * at several widths under the same hash (`/fp/<hash>-cc_ft_576.jpg`,
 * `-cc_ft_1536.jpg`, …); pick the widest of each and skip what is not a
 * listing photo (agent portraits are `-h_e.jpg`, floor plans `-o_a.jpg`).
 */
export function galleryPhotos(doc: Document): string[] {
    const best = new Map<string, { url: string; width: number }>();
    for (const img of doc.querySelectorAll<HTMLImageElement>("img")) {
        const candidates = [img.currentSrc, img.src, img.getAttribute("data-src"), ...(img.srcset ?? "").split(",").map((s) => s.trim().split(/\s+/)[0] ?? "")];
        for (const candidate of candidates) {
            if (!candidate) continue;
            let url: URL;
            try {
                url = new URL(candidate, doc.baseURI);
            } catch {
                continue;
            }
            if (url.hostname !== PHOTO_HOST) continue;
            const match = /\/fp\/([0-9a-f]{16,})-(?:cc_ft_|p_|uncropped_scaled_within_)?(\d+)?/.exec(url.pathname);
            if (!match) continue;
            if (/-h_[a-z]\.|-o_a\./.test(url.pathname)) continue;
            const hash = match[1]!;
            const width = Number(match[2] ?? 0);
            const known = best.get(hash);
            if (!known || width > known.width) best.set(hash, { url: url.href, width });
        }
    }
    return [...best.values()].map((entry) => entry.url);
}

/** The bed / bath / sqft facts: each container holds a value span and a label span. */
function factsFromDom(doc: Document): { beds: number | null; baths: number | null; sqft: number | null } {
    const facts = { beds: null as number | null, baths: null as number | null, sqft: null as number | null };
    for (const container of doc.querySelectorAll('[data-testid="bed-bath-sqft-fact-container"]')) {
        const [value, label] = texts(container, "span");
        const n = num(value);
        const key = (label ?? "").toLowerCase();
        if (n === null) continue;
        if (key.startsWith("bed") || key === "studio") facts.beds ??= n;
        else if (key.startsWith("bath")) facts.baths ??= n;
        else if (key.startsWith("sq")) facts.sqft ??= n;
    }
    // "Studio" pages show the word in the value span.
    for (const container of doc.querySelectorAll('[data-testid="bed-bath-sqft-fact-container"]')) {
        if (/studio/i.test(container.textContent ?? "") && facts.beds === null) facts.beds = 0;
    }
    return facts;
}

/** The building's breadcrumb, which names the building and links its page. */
function buildingFromBreadcrumb(doc: Document): { key: string | null; url: string | null; name: string | null } {
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/b/"], a[href*="/apartments/"]')) {
        const href = a.getAttribute("href");
        if (!href) continue;
        const ref = zillowUrls.parse(href.startsWith("/") ? `${ZILLOW_ORIGIN}${href}` : href);
        if (ref?.kind !== "building") continue;
        return { key: ref.sourceId, url: href.startsWith("/") ? `${ZILLOW_ORIGIN}${href}` : href, name: clean(a.textContent) };
    }
    return { key: null, url: null, name: null };
}

export function homeFromDom(doc: Document): { core: CoreFields; detail: ZillowDetail } {
    const core = emptyCore();
    const facts = factsFromDom(doc);
    core.rent = rangeOf(num(text(doc, '[data-testid="price"]')));
    core.beds = rangeOf(facts.beds);
    core.baths = rangeOf(facts.baths);
    core.sqft = rangeOf(facts.sqft);
    core.address = addressFromHeading(text(doc, '[data-testid="home-details-chip-container"] h1') ?? text(doc, "h1"));
    core.description = text(doc, '[data-testid="description"]');
    core.photoUrls = galleryPhotos(doc);

    const detail = emptyDetail("dom");
    const building = buildingFromBreadcrumb(doc);
    detail.buildingKey = building.key;
    detail.buildingUrl = building.url;
    detail.buildingName = building.name;
    return { core, detail };
}

export function buildingFromDom(doc: Document): { core: CoreFields; detail: ZillowDetail } {
    const core = emptyCore();
    core.name = clean(doc.querySelector("h1")?.textContent);
    core.propertyType = "apartment";
    core.description = text(doc, '[data-testid="description"]');
    core.photoUrls = galleryPhotos(doc);
    return { core, detail: emptyDetail("dom") };
}
