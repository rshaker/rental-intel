import { effect } from "@preact/signals";
import { persisted } from "./store";

/**
 * The panel's size. Chrome's zoom cannot be pointed at a side panel, so the
 * panel scales itself: the chosen percentage is applied as CSS `zoom` through
 * the `--ui-scale` custom property. It lives in localStorage so that
 * public/scale-boot.js can draw it before the first paint.
 */

export const PANEL_SCALES = ["75", "90", "100", "110", "125", "150", "175", "200"] as const;
export type PanelScale = (typeof PANEL_SCALES)[number];

export const SCALE_KEY = "intel.panel.scale";
export const DEFAULT_SCALE: PanelScale = "100";

export function parseScale(raw: unknown): PanelScale | null {
    return typeof raw === "string" && (PANEL_SCALES as readonly string[]).includes(raw) ? (raw as PanelScale) : null;
}

/** The size the panel is drawn at, as a percentage. */
export const scale = persisted<PanelScale>(SCALE_KEY, (raw) => parseScale(raw) ?? DEFAULT_SCALE, (value) => value);

/** Draws the size on every change, and follows a change a panel in another window made. */
export function watchScale(): void {
    effect(() => document.documentElement.style.setProperty("--ui-scale", String(Number(scale.value) / 100)));
    window.addEventListener("storage", (event) => {
        if (event.key !== SCALE_KEY) return;
        const next = parseScale(event.newValue);
        if (next) scale.value = next;
    });
}

/** The stop `delta` steps from `from`, or `from` itself at either end. */
export function neighbourScale(from: PanelScale, delta: -1 | 1): PanelScale {
    const index = PANEL_SCALES.indexOf(from) + delta;
    return PANEL_SCALES[Math.min(Math.max(index, 0), PANEL_SCALES.length - 1)]!;
}

/** What a key press asks of the size: a step up or down, 0 for back to normal, or null when it is not a size key. Ctrl or ⌘ with + (also =), − and 0. */
export function scaleShortcut(event: KeyboardEvent): -1 | 0 | 1 | null {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
    if (event.key === "=" || event.key === "+" || event.code === "NumpadAdd") return 1;
    if (event.key === "-" || event.key === "_" || event.code === "NumpadSubtract") return -1;
    if (event.key === "0") return 0;
    return null;
}

/** The size a shortcut leads to from the current one. */
export function steppedScale(delta: -1 | 0 | 1): PanelScale {
    return delta === 0 ? DEFAULT_SCALE : neighbourScale(scale.value, delta);
}
