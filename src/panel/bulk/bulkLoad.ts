import { sameRef, type ListingRef } from "../../db/types";
import { sendToWorker, type SaveOutcome, type SaveTabResponse, type StatusResponse } from "../../lib/messages";
import { getSettings } from "../../db/settings";
import { Cancelled, sleep } from "../../lib/poll";
import { TabClosed, activeTabId, navigateTab, pollTab } from "../tabDriver";
import type { UrlEntry } from "./urlList";

/**
 * Loading a list of listings one page at a time in the active tab, through
 * the same path the capture button takes. Only a confirmed listing is saved:
 * a page that has not confirmed within its budget makes the run stop and
 * wait on the person at the tab, who answers the site's check or skips it.
 * Runs in the panel because a run outlasts an idle service worker.
 */

/** The `bulk.*` settings, in the units the run works in. */
interface Limits {
    detectTimeoutMs: number;
    paceMs: number;
    maxConsecutiveFailures: number;
}

export interface BulkFailure {
    url: string;
    reason: string;
}

export interface BulkProgress {
    total: number;
    /** Entries finished, whatever their outcome. */
    done: number;
    saved: number;
    unchanged: number;
    failed: BulkFailure[];
    /** Set once the run ends early; null while running or when it ran to the end. */
    stopped: "cancelled" | "failures" | null;
}

/** What the run reports as it goes, in order, for a log to show. */
export type BulkEvent =
    | { type: "loading"; entry: UrlEntry; index: number }
    /** `ref` is the listing the page confirmed and the worker saved: the entry's, unless the site sent the tab elsewhere. */
    | { type: "result"; entry: UrlEntry; outcome: SaveOutcome; ref: ListingRef }
    | { type: "result"; entry: UrlEntry; outcome: "failed"; reason: string }
    /** The page has not confirmed in its budget; the run waits on the person at the tab. */
    | { type: "waiting"; entry: UrlEntry; reason: string }
    | { type: "done" };

/** The buttons' side of a run: Skip gives up on the listing in flight, Cancel ends the run at once. */
export class BulkControl {
    readonly #abort = new AbortController();
    #entry: AbortController | null = null;
    #skipped = false;

    get signal(): AbortSignal {
        return this.#abort.signal;
    }

    get cancelled(): boolean {
        return this.#abort.signal.aborted;
    }

    /** The signal for one entry's wait: it ends on Cancel and Skip. */
    beginEntry(): AbortSignal {
        this.#entry = new AbortController();
        this.#skipped = false;
        return AbortSignal.any([this.#abort.signal, this.#entry.signal]);
    }

    /** Whether the person skipped the entry in flight. */
    get skipped(): boolean {
        return this.#skipped;
    }

    skip(): void {
        this.#skipped = true;
        this.#entry?.abort();
    }

    cancel(): void {
        this.#abort.abort();
    }
}

export interface BulkLoadOptions {
    control: BulkControl;
    onEvent: (event: BulkEvent, progress: BulkProgress) => void;
}

export async function runBulkLoad(entries: readonly UrlEntry[], { control, onEvent }: BulkLoadOptions): Promise<BulkProgress> {
    const progress: BulkProgress = { total: entries.length, done: 0, saved: 0, unchanged: 0, failed: [], stopped: null };
    const emit = (event: BulkEvent): void => onEvent(event, { ...progress, failed: [...progress.failed] });
    const { signal } = control;
    const settings = await getSettings();
    const limits: Limits = {
        detectTimeoutMs: settings["bulk.detectTimeout"] * 1000,
        paceMs: settings["bulk.pace"] * 1000,
        maxConsecutiveFailures: settings["bulk.maxConsecutiveFailures"],
    };

    /** The tab the run drives; a new one is opened if the user closes it. */
    const tab = { id: await activeTabId() };
    let consecutiveFailures = 0;

    // Where the tab's document is once a navigation has committed; null while the page asked for is on its way. A site may send the tab elsewhere (Zillow redirects a coordinate URL to the keyed page), and that page is the one to take.
    const landed = { url: null as string | null };
    const onUpdated = (updated: number, change: { url?: string }): void => {
        if (updated === tab.id && change.url) landed.url = change.url;
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    try {
        for (const [index, entry] of entries.entries()) {
            if (signal.aborted) throw new Cancelled();
            if (consecutiveFailures >= limits.maxConsecutiveFailures) {
                progress.stopped = "failures";
                break;
            }

            emit({ type: "loading", entry, index });
            landed.url = null;
            tab.id = await navigateTab(tab.id, entry.url);

            const outcome = await saveOnce(tab.id, entry, limits.detectTimeoutMs, control, emit, landed);
            if (outcome.ok) {
                consecutiveFailures = 0;
                if (outcome.outcome === "saved") progress.saved += 1;
                else progress.unchanged += 1;
                emit({ type: "result", entry, outcome: outcome.outcome, ref: outcome.ref });
            } else {
                progress.failed.push({ url: entry.url, reason: outcome.reason });
                consecutiveFailures += 1;
                emit({ type: "result", entry, outcome: "failed", reason: outcome.reason });
            }

            progress.done += 1;
            if (progress.done < entries.length) await sleep(limits.paceMs, signal);
        }
    } catch (error) {
        if (!(error instanceof Cancelled)) throw error;
        progress.stopped = "cancelled";
    } finally {
        chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    emit({ type: "done" });
    return progress;
}

type SaveResult = { ok: true; outcome: "saved" | "unchanged"; ref: ListingRef } | { ok: false; reason: string };

/** One entry: wait for the tab to confirm this listing, then have the worker save it. The save gets one more try after a fresh confirmation, for a page that reloaded itself in between. */
async function saveOnce(tabId: number, entry: UrlEntry, detectTimeoutMs: number, control: BulkControl, emit: (event: BulkEvent) => void, landed: { url: string | null }): Promise<SaveResult> {
    const deadline = Date.now() + detectTimeoutMs;
    let lastFailure = "no listing was confirmed on the page";

    for (let attempt = 0; attempt < 2; attempt++) {
        const seen = await waitForDetection(tabId, entry, deadline, control, emit, landed);
        if (!seen.confirmed) return { ok: false, reason: seen.skipped ? `${seen.reason}; skipped` : seen.reason };

        const response = await sendToWorker<SaveTabResponse>({ type: "save-tab", tabId, expect: seen.confirmed });
        if (response?.outcome === "saved" || response?.outcome === "unchanged") return { ok: true, outcome: response.outcome, ref: seen.confirmed };

        lastFailure =
            !response ? "the extension did not answer"
            : response.outcome === "different-listing" ? "the page answered for a different listing"
            : response.outcome === "unreachable" ? "the page took no content script"
            : "the page could not be read";
    }
    return { ok: false, reason: lastFailure };
}

interface Seen {
    /** The listing the page confirmed: the entry's, or the one the site sent the tab to. Null when it confirmed none. */
    confirmed: ListingRef | null;
    /** Why not, when it did not: what the page showed instead, or the site's check. */
    reason: string;
    skipped: boolean;
}

/** How often the loading tab is asked what it shows. */
const POLL_MS = 500;

/** Asks the tab until it confirms `entry`'s listing. Only an answer from the page at the wanted URL counts: the page being left keeps answering for itself for a while. Past `deadline` the run says so and waits on the person at the tab, until the page confirms, they Skip, or they Cancel. */
async function waitForDetection(tabId: number, entry: UrlEntry, deadline: number, control: BulkControl, emit: (event: BulkEvent) => void, landed: { url: string | null }): Promise<Seen> {
    const wanted = entry.ref;
    let reason = "no listing was confirmed on the page";
    const accept = (response: StatusResponse | undefined): ListingRef | null => {
        if (response?.source !== wanted.source) return null;
        if (response.urlListingId === wanted.sourceId) {
            if (response.listing && sameRef(response.listing.ref, wanted)) return response.listing.ref;
            if (response.challenge) reason = response.challenge;
            else if (response.listing) reason = `the page shows ${response.listing.ref.sourceId} instead`;
            return null;
        }
        if (response.listing && landed.url !== null && response.url === landed.url && response.url !== entry.url) return response.listing.ref;
        return null;
    };
    const signal = control.beginEntry();
    try {
        const first = await pollTab<StatusResponse, ListingRef>(tabId, { type: "status" }, accept, { deadline, every: POLL_MS, signal });
        if (first) return { confirmed: first, reason, skipped: false };
        emit({ type: "waiting", entry, reason });
        const later = await pollTab<StatusResponse, ListingRef>(tabId, { type: "status" }, accept, { deadline: Infinity, every: POLL_MS, signal });
        return { confirmed: later, reason, skipped: false };
    } catch (error) {
        if (error instanceof TabClosed) return { confirmed: null, reason: "the tab was closed", skipped: false };
        if (error instanceof Cancelled && !control.cancelled) return { confirmed: null, reason, skipped: control.skipped };
        throw error;
    }
}
