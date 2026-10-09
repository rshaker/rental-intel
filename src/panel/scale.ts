import { PANEL_SCALES, isValidValue, type PanelScale } from "../db/settingsSchema";
import { readStored, store } from "./store";

/**
 * The panel's own size control. Chrome's zoom cannot be pointed at a side
 * panel (Ctrl/⌘ and + go to the tab beside it, and the sidePanel API has no
 * zoom), so the panel scales itself: the "Size" setting is applied as CSS
 * `zoom` on the body through the `--ui-scale` custom property, which
 * panel.css also divides viewport units by, since zoom multiplies those too.
 *
 * The setting lives in the settings table like any other, but the table is
 * asynchronous and the first paint is not, so the size last drawn is kept in
 * localStorage as well. public/scale-boot.js, a classic script in the panel's
 * head, applies it before the first paint (this bundle is deferred and can
 * run a frame late); `bootScale()` reads the same value so this module knows
 * what is on screen, and `render()` corrects it from the table on every
 * pass. Writing that key is also how one extension page tells another: the
 * options page publishes a change there, and every open panel hears it
 * through the `storage` event.
 *
 * Dexie-free on purpose, so the keyboard logic can be unit-tested; the write
 * to the table is the caller's (main.ts).
 */

/** The localStorage mirror of the setting: `intel.panel.*`, as state.ts keeps the rest. */
export const SCALE_KEY = "intel.panel.scale";

export const DEFAULT_SCALE: PanelScale = "100";

/** What the panel is drawn at right now. */
let current: PanelScale = DEFAULT_SCALE;

export function currentScale(): PanelScale {
    return current;
}

/** `raw` as a size, when it is one. */
export function parseScale(raw: unknown): PanelScale | null {
    return isValidValue("appearance.scale", raw) ? raw : null;
}

/** Draws this page at `scale`. */
function draw(scale: PanelScale): void {
    current = scale;
    document.documentElement.style.setProperty("--ui-scale", String(Number(scale) / 100));
}

/** Tells every other extension page what size the panel is. */
export function publishScale(scale: PanelScale): void {
    store(SCALE_KEY, scale);
}

/** Draws this panel at `scale` and publishes it. */
export function applyScale(scale: PanelScale): void {
    if (scale !== current) draw(scale);
    publishScale(scale);
}

/**
 * Takes up the size the panel last used, from the mirror, before the table
 * has been read. scale-boot.js has normally drawn it already; this records
 * it here, and draws it on a page that did not run that script.
 */
export function bootScale(): void {
    const cached = parseScale(readStored(SCALE_KEY));
    if (cached) draw(cached);
}

/** Follows sizes other extension pages publish: the options page, or a panel in another window. */
export function watchScale(): void {
    window.addEventListener("storage", (event) => {
        if (event.key !== SCALE_KEY) return;
        const next = parseScale(event.newValue);
        if (next && next !== current) draw(next);
    });
}

/** The stop `delta` steps from `scale`, or `scale` itself at either end. */
export function neighbourScale(scale: PanelScale, delta: -1 | 1): PanelScale {
    const index = PANEL_SCALES.indexOf(scale) + delta;
    return PANEL_SCALES[Math.min(Math.max(index, 0), PANEL_SCALES.length - 1)]!;
}

/**
 * What a key press asks of the size: a step up or down, 0 for back to normal,
 * or null when it is not a size key. The browser's own bindings -- Ctrl or ⌘
 * with + (which is also =), − and 0 -- taken over for the panel, since in a
 * side panel they would otherwise zoom the tab beside it.
 */
export function scaleShortcut(event: KeyboardEvent): -1 | 0 | 1 | null {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
    if (event.key === "=" || event.key === "+" || event.code === "NumpadAdd") return 1;
    if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") return -1;
    if (event.key === "0") return 0;
    return null;
}

/** The size a shortcut leads to from the current one. */
export function steppedScale(delta: -1 | 0 | 1): PanelScale {
    return delta === 0 ? DEFAULT_SCALE : neighbourScale(current, delta);
}
