import { signal, type ReadonlySignal } from "@preact/signals";
import { sameRef, type ListingKind, type ListingRef } from "../db/types";
import { sendToTab, type StatusResponse } from "../lib/messages";
import type { SourceDescriptor } from "../sources/contract";
import { isSourceId, sourceForUrl } from "../sources";

/**
 * The tab beside the panel, and what it shows. The panel asks; the content
 * script answers. While the tab's URL names a listing of an enabled source
 * and the page has not confirmed it, the tab is asked on a schedule: often
 * for the first seconds, since on a single-page site the document catches up
 * with its URL a beat late, then sparsely for a while, since a page can
 * finish arriving well after that. A tab on any other URL is not asked.
 *
 * Chrome's tab events say when to start over and when merely to ask again.
 * A new URL (`tabs.onUpdated` reports a pushState for any host the
 * extension has access to) is a new page: what was known goes, and the
 * look starts afresh. A status change with no new URL is a reload or a
 * same-document history commit -- Next.js does a replaceState of the current
 * URL once it has hydrated -- and the last answer stays up while the page is
 * asked again, so a confirmed listing never flickers to "Try to capture".
 *
 * A page that is being left can still answer for itself after the tab has
 * been told to navigate; its answer names its own URL's listing, not the one
 * now wanted, and is ignored.
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

/** When the tab is asked, from the moment its URL names a listing. The first three seconds are the busy ones. */
const SCHEDULE_MS = [0, 500, 500, 500, 500, 500, 500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000];
/** How many steps of the schedule count as "still checking"; after them the row says nothing was confirmed while the looks go on. */
const BUSY_STEPS = 7;

export interface ActiveTabOptions {
    isEnabled(source: SourceDescriptor): boolean;
    /** A listing URL that never confirmed, and what the probes said: for the activity log. */
    onGaveUp(text: string): void;
}

export interface ActiveTab {
    readonly state: ReadonlySignal<ActiveTabState>;
    /** Asks the tab again, keeping what is known until it answers: a source was enabled, or a script was put in the tab. */
    recheck(): void;
}

/** The listing a URL names, when it is an enabled source's listing URL. */
export function subjectOf(url: string | null, isEnabled: (source: SourceDescriptor) => boolean): ListingRef | null {
    if (!url) return null;
    const source = sourceForUrl(url);
    if (!source || !isEnabled(source)) return null;
    const ref = source.urls.parse(url);
    return ref && isSourceId(source.id) ? { source: source.id, sourceId: ref.sourceId } : null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function watchActiveTab({ isEnabled, onGaveUp }: ActiveTabOptions): ActiveTab {
    const state = signal<ActiveTabState>({ tabId: null, url: null, listing: null, checking: false, challenge: null });
    let controller: AbortController | null = null;
    let windowId: number | undefined;

    const patch = (changes: Partial<ActiveTabState>): void => {
        state.value = { ...state.value, ...changes };
    };

    /** Asks the tab on the schedule until it confirms the listing its URL names. `keep` leaves the last answer up meanwhile. */
    function poll(keep: boolean): void {
        controller?.abort();
        const run = new AbortController();
        controller = run;
        const { tabId, url } = state.value;
        const wanted = subjectOf(url, isEnabled);
        if (tabId === null || !wanted) {
            patch({ listing: null, checking: false, challenge: null });
            return;
        }
        patch({ listing: keep ? state.value.listing : null, checking: true, challenge: null });

        void (async () => {
            let detail: string | null = null;
            for (const [step, delay] of SCHEDULE_MS.entries()) {
                if (delay) await sleep(delay);
                if (run.signal.aborted) return;
                if (step === BUSY_STEPS && state.value.checking) patch({ checking: false });
                const response = await sendToTab<StatusResponse>(tabId, { type: "status" });
                if (run.signal.aborted) return;
                // No script yet, or the page being left still answering for itself: ask again.
                if (!response || response.subject !== wanted.sourceId || response.source !== wanted.source) continue;
                if (response.listing && sameRef(response.listing.ref, wanted)) {
                    patch({ listing: response.listing, checking: false, challenge: null });
                    return;
                }
                detail = response.detail;
                if (response.challenge !== state.value.challenge) patch({ challenge: response.challenge });
            }
            patch({ listing: null, checking: false });
            // A listing URL that never confirmed is worth a line in the log: a
            // redesign, or a page that is not a listing after all, and the
            // surviving signals say which.
            onGaveUp(`${wanted.source} ${wanted.sourceId} never confirmed: ${detail ?? "no content script answered"}`);
        })();
    }

    /** A new tab, or a new page in it: forget what was known and look afresh. */
    function setActive(tabId: number | null, url: string | null): void {
        state.value = { tabId, url, listing: null, checking: false, challenge: null };
        poll(false);
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
        else if (changeInfo.url || changeInfo.status) poll(true);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === state.value.tabId) controller?.abort();
    });

    return { state, recheck: () => poll(true) };
}
