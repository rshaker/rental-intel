import { signal, type ReadonlySignal } from "@preact/signals";
import { sameRef, type ListingKind, type ListingRef } from "../db/types";
import { sendToTab, type StatusResponse } from "../lib/messages";
import { Cancelled, poll } from "../lib/poll";
import type { SourceDescriptor } from "../sources/contract";
import { isSourceId, sourceForUrl } from "../sources";

/**
 * The active tab, and what it shows. While its URL names a listing of an
 * enabled source and the page has not confirmed it, the tab is asked on a
 * schedule: often for the first seconds (a single-page site's document
 * catches up with its URL a beat late), then sparsely. A new URL starts
 * over; a reload or same-document commit keeps the last answer up while
 * the page is asked again, so a confirmed listing never flickers.
 */

export interface TabListing {
    ref: ListingRef;
    kind: ListingKind | null;
    price: number | null;
}

export interface ActiveTabState {
    tabId: number | null;
    url: string | null;
    /** The confirmed listing, when the page agrees with its URL. */
    listing: TabListing | null;
    /** The page is being looked at: its URL names a listing it has not confirmed yet. */
    checking: boolean;
    /** The site's check that the visitor is a person, when the page is one. */
    challenge: string | null;
}

/** Delays before each ask, from the moment the URL names a listing. */
const SCHEDULE_MS = [0, 500, 500, 500, 500, 500, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];
/** How many asks count as "still checking"; after them the row says nothing was confirmed while the asks go on. */
const BUSY_STEPS = 7;

export interface ActiveTabOptions {
    isEnabled(source: SourceDescriptor): boolean;
    /** A listing URL that never confirmed, and what the checks said: for the activity log. */
    onGaveUp(text: string): void;
}

export interface ActiveTab {
    readonly state: ReadonlySignal<ActiveTabState>;
    /** Reads the tab again and asks it, keeping what is known until it answers: a source was enabled, or a script was put in the tab. */
    recheck(): void;
}

/** The source a URL belongs to when that source is off: the capture row offers to enable it. */
export function offSourceForUrl(url: string | null, isEnabled: (source: SourceDescriptor) => boolean): SourceDescriptor | null {
    if (!url) return null;
    const source = sourceForUrl(url);
    return source && !isEnabled(source) ? source : null;
}

/** The listing a URL names, when it is an enabled source's listing URL. */
export function listingIdInUrl(url: string | null, isEnabled: (source: SourceDescriptor) => boolean): ListingRef | null {
    if (!url) return null;
    const source = sourceForUrl(url);
    if (!source || !isEnabled(source)) return null;
    const ref = source.urls.parse(url);
    return ref && isSourceId(source.id) ? { source: source.id, sourceId: ref.sourceId } : null;
}

export function watchActiveTab({ isEnabled, onGaveUp }: ActiveTabOptions): ActiveTab {
    const state = signal<ActiveTabState>({ tabId: null, url: null, listing: null, checking: false, challenge: null });
    let controller: AbortController | null = null;
    let windowId: number | undefined;

    const patch = (changes: Partial<ActiveTabState>): void => {
        state.value = { ...state.value, ...changes };
    };

    /** Asks the tab on the schedule until it confirms the listing its URL names. `keep` leaves the last answer up meanwhile. */
    function ask(keep: boolean): void {
        controller?.abort();
        const run = new AbortController();
        controller = run;
        const { tabId, url } = state.value;
        const wanted = listingIdInUrl(url, isEnabled);
        if (tabId === null || !wanted) {
            patch({ listing: null, checking: false, challenge: null });
            return;
        }
        patch({ listing: keep ? state.value.listing : null, checking: true, challenge: null });

        void (async () => {
            let detail: string | null = null;
            try {
                const found = await poll(
                    () => sendToTab<StatusResponse>(tabId, { type: "status" }),
                    (response, step) => {
                        if (step === BUSY_STEPS && state.value.checking) patch({ checking: false });
                        // No script yet, or the page being left still answering for itself: ask again.
                        if (!response || response.urlListingId !== wanted.sourceId || response.source !== wanted.source) return null;
                        if (response.listing && sameRef(response.listing.ref, wanted)) return response.listing;
                        detail = response.detail;
                        if (response.challenge !== state.value.challenge) patch({ challenge: response.challenge });
                        return null;
                    },
                    { every: (attempt) => SCHEDULE_MS[attempt] ?? null, signal: run.signal },
                );
                if (found) {
                    patch({ listing: found, checking: false, challenge: null });
                    return;
                }
            } catch (error) {
                if (error instanceof Cancelled) return;
                throw error;
            }
            patch({ listing: null, checking: false });
            onGaveUp(`${wanted.source} ${wanted.sourceId} never confirmed: ${detail ?? "no content script answered"}`);
        })();
    }

    /** A new tab, or a new page in it: forget what was known and look afresh. */
    function setActive(tabId: number | null, url: string | null): void {
        state.value = { tabId, url, listing: null, checking: false, challenge: null };
        ask(false);
    }

    void (async () => {
        const window = await chrome.windows.getCurrent();
        windowId = window.id;
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        setActive(tab?.id ?? null, tab?.url ?? null);
    })();

    chrome.tabs.onActivated.addListener((info) => {
        if (info.windowId !== windowId) return;
        void chrome.tabs.get(info.tabId).then(
            (tab) => setActive(info.tabId, tab.url ?? null),
            () => setActive(info.tabId, null),
        );
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
        if (tabId !== state.value.tabId) return;
        if (changeInfo.url && changeInfo.url !== state.value.url) setActive(tabId, changeInfo.url);
        else if (changeInfo.url || changeInfo.status) ask(true);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === state.value.tabId) controller?.abort();
    });

    /** The tab's URL may have changed, or become visible, since it was last read: a fresh one starts over, the same one is asked again. */
    function recheck(): void {
        const { tabId, url } = state.value;
        if (tabId === null) return;
        chrome.tabs.get(tabId).then(
            (tab) => ((tab.url ?? null) !== url ? setActive(tabId, tab.url ?? null) : ask(true)),
            () => ask(true),
        );
    }

    return { state, recheck };
}
