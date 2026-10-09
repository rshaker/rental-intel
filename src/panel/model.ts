import { computed, signal } from "@preact/signals";
import { headlinePrice, NO_LINK_IDS, sameRef, type Listing } from "../db/types";
import { sendToWorker, type SaveTabResponse } from "../lib/messages";
import { sourceById, sourceLabel } from "../sources";
import { activity } from "./activityLog";
import { watchActiveTab } from "./activeTab";
import { isEnabled } from "./grants";
import { liveListings } from "./live";
import { orderForDisplay, relate } from "./query";
import { plural } from "./format";
import { filters, sort } from "./store";

/** The Listings tab's model: what the list shows, derived from the live listings and the stored view, and the capture row's state. */

export const activeTab = watchActiveTab({ isEnabled, onGaveUp: (text) => activity.say(text, "warn") });

/** Every listing, or none until the first read lands. */
export const everything = computed<readonly Listing[]>(() => liveListings.value ?? []);

export const relations = computed(() => relate(everything.value, (listing) => sourceById(listing.source)?.linkIds?.(listing.detail) ?? NO_LINK_IDS));

/** The saved listing for what the active tab is showing, if either exists. */
export const activeListing = computed<Listing | null>(() => {
    const current = activeTab.state.value.listing;
    if (!current) return null;
    return everything.value.find((listing) => sameRef(listing, current.ref)) ?? null;
});

/** The listings on screen, filtered, sorted, the active one floated in the default view. */
export const ordered = computed(() => orderForDisplay(everything.value, filters.value, sort.value, activeListing.value?.id ?? null, sourceLabel));

// The capture row

/** What the capture button would do now, from the active tab's answer and the saved listing's headline price. */
export type CaptureState = "try" | "new" | "update" | "saved";

export const captureState = computed<CaptureState>(() => {
    const current = activeTab.state.value.listing;
    const existing = activeListing.value;
    return !current ? "try" : !existing ? "new" : headlinePrice(existing.core) !== current.price ? "update" : "saved";
});

/** The outcome of the last capture, shown in place of the state until the tab moves on. */
export const captureNote = signal("");
export const saving = signal(false);
/** The photo fetch the capture row is reporting on, if any. */
export const photosArriving = signal<{ listingId: string; done: number; total: number } | null>(null);

export function photosNote(): string {
    const arriving = photosArriving.value;
    if (!arriving) return "";
    return `Saved. Fetching ${plural(arriving.total, "photo")}${arriving.done ? ` (${arriving.done} of ${arriving.total})` : ""}…`;
}

const CAPTURE_NOTES: Record<SaveTabResponse["outcome"] | "failed", string> = {
    saved: "Saved.",
    unchanged: "Already up to date.",
    "no-listing": "No listing found on this page.",
    unreachable: "The extension cannot reach this page. Reload the page and try again.",
    "different-listing": "The page answered for a different listing.",
    failed: "The extension did not answer.",
};

/** Saves the active tab through the worker. Returns the saved listing's id. */
export async function captureActiveTab(): Promise<string | null> {
    const tabId = activeTab.state.value.tabId;
    if (tabId === null || saving.value) return null;
    saving.value = true;
    captureNote.value = "Saving…";
    const response = await sendToWorker<SaveTabResponse>({ type: "save-tab", tabId });
    saving.value = false;
    let note = CAPTURE_NOTES[response?.outcome ?? "failed"];
    // The save may have put a script into an unresponsive tab; ask the page again.
    activeTab.recheck();
    if (response?.partial && (response.outcome === "saved" || response.outcome === "unchanged")) {
        note = "Saved from the page layout only. Reload the page and re-capture for the full record.";
    }
    // The photos are still on their way; the row says so until the last one lands.
    photosArriving.value = response?.outcome === "saved" && response.listingId && response.photos ? { listingId: response.listingId, done: 0, total: response.photos } : null;
    if (photosArriving.value && !response?.partial) note = photosNote();
    captureNote.value = note;
    return response?.listingId ?? null;
}
