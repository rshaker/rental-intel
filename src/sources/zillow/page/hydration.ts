import { idString } from "../../shared/values";
import { zillowUrls } from "../urls";

/**
 * Reading Zillow's hydration payload: the page's data model as JSON in
 * `<script id="__NEXT_DATA__">`, with coordinates, every photo and a numeric
 * price. Verified against the September 2026 captures: a home's node is under
 * `componentProps.gdpClientCache` (a JSON string inside the JSON), a
 * building's under `initialReduxState.gdp.building`, keyed by lotId with the
 * URL key only in its `bdpUrl`.
 */

/** Script tags that carry the payload, in order of trust. The first is written by the main-world script (zillow.main.ts) after an in-page navigation. */
export const HYDRATION_SELECTORS = ["script#__intel_zillow_state", "script#__NEXT_DATA__", "script#hdpApolloPreloadedData", 'script[type="application/json"][id]'];

/** Every payload blob that describes a listing, in order of trust. More than one can be present after an in-page move. */
export function readHydrationStates(doc: Document): unknown[] {
    const states: unknown[] = [];
    const seen = new Set<Element>();
    for (const selector of HYDRATION_SELECTORS) {
        for (const script of doc.querySelectorAll(selector)) {
            if (seen.has(script)) continue;
            seen.add(script);
            const state = parsedBlock(script);
            if (state !== null) states.push(state);
        }
    }
    return states;
}

/** A block's parsed payload, cached per element against its text: the block is a megabyte and is read several times per ask. */
const parsed = new WeakMap<Element, { text: string; state: unknown }>();

function parsedBlock(script: Element): unknown {
    const text = script.textContent?.trim() ?? "";
    if (!text) return null;
    const cached = parsed.get(script);
    if (cached && cached.text === text) return cached.state;
    let state: unknown = null;
    try {
        const unwrapped = unwrapNestedJson(JSON.parse(text));
        if (looksLikeHomeState(unwrapped) || looksLikeBuildingState(unwrapped)) state = unwrapped;
    } catch {
        // Not JSON, or not JSON we understand.
    }
    parsed.set(script, { text, state });
    return state;
}

/** The property node for `zpid` in whichever blob has it, else the first property node found (so a caller can see which listing the page describes instead). */
export function findPropertyNodeIn(states: readonly unknown[], zpid: string | null): { node: Node; wanted: boolean } | null {
    if (zpid) {
        for (const state of states) {
            const node = findPropertyNode(state, zpid);
            if (node) return { node, wanted: true };
        }
    }
    for (const state of states) {
        const node = findPropertyNode(state);
        if (node) return { node, wanted: zpid === null };
    }
    return null;
}

/** As findPropertyNodeIn, for buildings. */
export function findBuildingNodeIn(states: readonly unknown[], key: string | null): { node: Node; wanted: boolean } | null {
    if (key) {
        for (const state of states) {
            const node = findBuildingNode(state, key);
            if (node) return { node, wanted: true };
        }
    }
    for (const state of states) {
        const node = findBuildingNode(state);
        if (node) return { node, wanted: key === null };
    }
    return null;
}

/** Parses any JSON-looking string anywhere in the tree, so a double-encoded cache reads like the rest of the payload. */
function unwrapNestedJson(value: unknown, depth = 0): unknown {
    if (depth > 40) return value;
    if (typeof value === "string") {
        if (value.length < 64 || !/^\s*[[{]/.test(value)) return value;
        try {
            return unwrapNestedJson(JSON.parse(value), depth + 1);
        } catch {
            return value;
        }
    }
    if (Array.isArray(value)) return value.map((item) => unwrapNestedJson(item, depth + 1));
    if (typeof value === "object" && value !== null) {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) out[key] = unwrapNestedJson(inner, depth + 1);
        return out;
    }
    return value;
}

/** Whether a blob holds a listing node at all; keeps analytics blobs away from the field readers. */
function looksLikeHomeState(value: unknown): boolean {
    return findPropertyNode(value) !== null;
}

function looksLikeBuildingState(value: unknown): boolean {
    return findBuildingNode(value) !== null;
}

export type Node = Record<string, unknown>;

/** Breadth-first search for the first node satisfying `matches`, or only one whose identity is `wanted`: a "nearby homes" carousel holds other listings' nodes. */
function findNode(root: unknown, matches: (node: Node) => boolean, identityOf: (node: Node) => string | null, wanted?: string | null): Node | null {
    const queue: unknown[] = [root];
    while (queue.length) {
        const value = queue.shift();
        if (typeof value !== "object" || value === null) continue;
        const node = value as Node;
        if (matches(node) && (!wanted || identityOf(node) === wanted)) return node;
        queue.push(...Object.values(node));
    }
    return null;
}

/** The object describing one property (home). */
export function findPropertyNode(root: unknown, preferZpid?: string | null): Node | null {
    return findNode(
        root,
        (node) => "zpid" in node && ("price" in node || "bedrooms" in node),
        (node) => idString(node["zpid"]),
        preferZpid,
    );
}

/** The URL key of a building node, which Zillow only exposes through its `bdpUrl`. */
export function buildingKeyOf(node: Node): string | null {
    const url = node["bdpUrl"];
    const ref = typeof url === "string" ? zillowUrls.parse(url) : null;
    return ref?.kind === "building" ? ref.sourceId : null;
}

/** The object describing one building. */
export function findBuildingNode(root: unknown, preferKey?: string | null): Node | null {
    return findNode(root, (node) => "lotId" in node && ("floorPlans" in node || "buildingName" in node), buildingKeyOf, preferKey);
}
