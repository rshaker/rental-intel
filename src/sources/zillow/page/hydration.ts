import { idString } from "../../shared/values";
import { zillowUrls } from "../urls";

/**
 * Reading Zillow's hydration payload.
 *
 * Zillow server-renders React and embeds the page's whole data model as JSON in
 * a <script id="__NEXT_DATA__"> at the end of <body>. That blob is the best thing
 * on the page: it carries lat/lng, the full photo set, and a numeric price
 * rather than a formatted string. It is also the strongest signal that the
 * document really is one listing, which is why detection lives on top of this.
 *
 * Verified against captures (playwright/fixtures/zillow-*.html, September 2026):
 *   home      props.pageProps.componentProps.gdpClientCache -- a JSON *string* --
 *             whose one "ForRentShopperPlatformFullRenderQuery{…}" entry holds
 *             `.property`, keyed by zpid.
 *   building  props.pageProps.componentProps.initialReduxState.gdp.building,
 *             keyed by lotId, with the URL key only inside its `bdpUrl`.
 *
 * Every reader takes an explicit `doc` so it can run over a parsed fixture in a
 * unit test instead of only inside a content script.
 */

/**
 * Script tags that carry the hydration payload, in order of trust. The first
 * is written by the page-world helper (zillow.main.ts) after an in-page
 * navigation, when `__NEXT_DATA__` still describes the page the tab first
 * loaded; the rest are where Zillow itself has put the payload.
 */
export const HYDRATION_SELECTORS = ["script#__intel_zillow_state", "script#__NEXT_DATA__", "script#hdpApolloPreloadedData", 'script[type="application/json"][id]'];

/**
 * Finds and parses every payload blob that describes a listing, in order of
 * trust. Zillow double-encodes part of its payload (the home page's client
 * cache is a JSON string inside the JSON), hence the unwrap.
 *
 * More than one blob can be present: the helper's element and Zillow's own
 * `__NEXT_DATA__`, describing different listings after an in-page move. The
 * readers look through all of them for the listing they want.
 */
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

/**
 * A block's parsed, unwrapped payload, or null when it is not one. Cached per
 * element against its text: detection runs several probes and extraction
 * runs again after them, and the block is a megabyte. Comparing the text is
 * a memory compare; parsing and rebuilding it is not.
 */
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

/** The most trusted listing-shaped blob, or null. */
export function readHydrationState(doc: Document): unknown {
    return readHydrationStates(doc)[0] ?? null;
}

/**
 * The property node for `zpid` in whichever blob has it, else the first
 * property node of the first blob (so a caller can see which listing the page
 * describes instead).
 */
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

/**
 * Parses any JSON-looking string anywhere in the tree, so a double-encoded
 * cache reads like the rest of the payload. Rebuilds the object, which on a
 * quarter-megabyte blob is fine for a once-per-navigation read.
 */
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

/**
 * Gates so we don't hand analytics blobs to the field readers. Structural on
 * purpose: an earlier version grepped the first 20KB of the stringified blob,
 * and on real pages the node of interest sits a quarter-megabyte in, behind a
 * cache of unrelated queries. Exported because "the page carries a
 * listing-shaped payload" is itself a detection signal, not just a parsing
 * precondition.
 */
export function looksLikeHomeState(value: unknown): boolean {
    return findPropertyNode(value) !== null;
}

export function looksLikeBuildingState(value: unknown): boolean {
    return findBuildingNode(value) !== null;
}

export type Node = Record<string, unknown>;

/**
 * Breadth-first search for the first node satisfying `matches`, optionally
 * only one whose identity is `wanted`.
 *
 * The preference matters more than it looks. Without it this returns whichever
 * matching node happens to come first in the payload, which on a page with a
 * "nearby homes" carousel is an arbitrary *other* listing. Pass the identity
 * you actually want whenever you know it.
 */
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

/**
 * The object describing one building. Comparable buildings ("comps") and a
 * home's "nearby buildings" have the same shape, hence the preference.
 */
export function findBuildingNode(root: unknown, preferKey?: string | null): Node | null {
    return findNode(root, (node) => "lotId" in node && ("floorPlans" in node || "buildingName" in node), buildingKeyOf, preferKey);
}

/** The home identity the hydration payload claims, if it claims one. */
export function hydrationZpid(state: unknown, preferZpid?: string | null): string | null {
    return idString(findPropertyNode(state, preferZpid)?.["zpid"]);
}

/** The building identity the hydration payload claims, if it claims one. */
export function hydrationBuildingKey(state: unknown, preferKey?: string | null): string | null {
    const node = findBuildingNode(state, preferKey);
    return node ? buildingKeyOf(node) : null;
}
