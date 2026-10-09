import type { Address, GeoPoint } from "../../db/types";
import { clean, num, record, str } from "./values";

/** Reading JSON-LD, which sites emit for crawlers and so survives redesigns better than selectors. */

export type LdNode = Record<string, unknown>;

/** Every node from every JSON-LD block on the page, flattened; malformed blocks are skipped. */
export function ldNodes(doc: Document): LdNode[] {
    const nodes: LdNode[] = [];
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
        const text = script.textContent?.trim();
        if (!text) continue;
        try {
            nodes.push(...flattenLd(JSON.parse(text)));
        } catch {
        }
    }
    return nodes;
}

/** An object, an array of them, or a `@graph`, as a flat list of nodes. */
export function flattenLd(value: unknown): LdNode[] {
    if (Array.isArray(value)) return value.flatMap(flattenLd);
    const node = record(value);
    if (!node) return [];
    const graph = node["@graph"];
    return graph ? [node, ...flattenLd(graph)] : [node];
}

/** The `@type`s of a node, which may be one string or a list. */
export function ldTypes(node: LdNode): string[] {
    return [node["@type"]].flat().filter((type): type is string => typeof type === "string");
}

/** The first node whose `@type` is one of `types`. */
export function ldNodeOfType(nodes: readonly LdNode[], types: ReadonlySet<string>): LdNode | null {
    return nodes.find((node) => ldTypes(node).some((type) => types.has(type))) ?? null;
}

/** A schema.org PostalAddress as our Address. `text` is assembled from the parts. */
export function ldAddress(value: unknown): Address | null {
    const node = record(value);
    if (!node) {
        const text = clean(str(value));
        return text ? { line1: null, unit: null, city: null, state: null, zip: null, text } : null;
    }
    const line1 = clean(str(node["streetAddress"]));
    const city = clean(str(node["addressLocality"]));
    const state = clean(str(node["addressRegion"]));
    const zip = clean(str(node["postalCode"]));
    const text = [line1, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
    if (!text) return null;
    return { line1, unit: null, city, state, zip, text };
}

/** A schema.org GeoCoordinates as a point. */
export function ldGeo(value: unknown): GeoPoint | null {
    const node = record(value);
    const lat = num(node?.["latitude"]);
    const lng = num(node?.["longitude"]);
    return lat !== null && lng !== null ? { lat, lng } : null;
}

/** `image` is a URL, an ImageObject, or a list of either. */
export function ldImages(value: unknown): string[] {
    const out: string[] = [];
    for (const item of [value].flat()) {
        const url = str(item) ?? str(record(item)?.["url"]) ?? str(record(item)?.["contentUrl"]);
        if (url) out.push(url);
    }
    return [...new Set(out)];
}
