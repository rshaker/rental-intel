import { clean } from "./values";

/** Small DOM readers every source's page module leans on. */

export function canonicalHref(doc: Document): string | null {
    return doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? null;
}

export function ogUrl(doc: Document): string | null {
    return doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ?? null;
}

export function metaContent(doc: Document, selector: string): string | null {
    return clean(doc.querySelector<HTMLMetaElement>(selector)?.content);
}

/** The trimmed text of the first element matching `selector`, else null. */
export function text(root: ParentNode, selector: string): string | null {
    return clean(root.querySelector(selector)?.textContent);
}

/** Trimmed, non-empty texts of every element matching `selector`. */
export function texts(root: ParentNode, selector: string): string[] {
    return [...root.querySelectorAll(selector)].map((el) => clean(el.textContent)).filter((t): t is string => t !== null);
}

/** A data attribute, trimmed, else null. */
export function data(el: Element | null, name: string): string | null {
    return clean(el?.getAttribute(`data-${name}`));
}

/** Whether an <h1> on the page has at least `minLength` characters of text. */
export function hasHeading(doc: Document, minLength = 3): boolean {
    return [...doc.querySelectorAll("h1")].some((h1) => (clean(h1.textContent)?.length ?? 0) >= minLength);
}

/**
 * Image URLs on the page whose src (or lazy-load data attribute) is on one of
 * `hosts` (bare hostnames, subdomains included). The DOM fallback's only
 * source of photos, and a last resort for a page whose payload has none.
 */
export function imageUrls(doc: Document, hosts: readonly string[]): string[] {
    const urls = new Set<string>();
    for (const img of doc.querySelectorAll("img")) {
        for (const candidate of [img.currentSrc, img.src, img.getAttribute("data-src"), img.getAttribute("data-image")]) {
            if (!candidate) continue;
            try {
                const host = new URL(candidate, doc.baseURI).hostname;
                if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) urls.add(new URL(candidate, doc.baseURI).href);
            } catch {
                // Not a URL. Skip it.
            }
        }
    }
    return [...urls];
}
