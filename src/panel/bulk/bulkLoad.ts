import { sameRef, type ListingRef } from "../../db/types";
import { sendToWorker, type SaveOutcome, type SaveTabResponse, type StatusResponse } from "../../lib/messages";
import { getSettings } from "../../db/settings";
import { Cancelled, TabClosed, delay, navigateTab, pollTab, tabBesideThePanel } from "../tabDriver";
import type { UrlEntry } from "./urlList";

/**
 * Loading a list of listings, one page at a time, through the same path the
 * capture button takes, in the tab beside the panel.
 *
 * The extension never fetches listing pages itself: every site's bot
 * detection treats anything that is not a browser showing a page to a person
 * as hostile, and the extractors are verified against the document a content
 * script sees, not the server's HTML. So a bulk load is the user's own tab
 * (../tabDriver.ts), walked through the URLs; each page is asked what it
 * shows until its content script confirms the listing the way it would for
 * a click, and then the worker saves that tab exactly as if the button had
 * been clicked.
 *
 * Only a *confirmed* listing is saved. A click on an unconfirmed page forces a
 * parse anyway, because a person is looking at the page and can judge the
 * result; here the judgement is theirs too, but differently: a page that has
 * not confirmed within its budget makes the run stop and say so, and wait.
 * The person sees what the tab shows -- a site asking them to prove they are
 * a person, a page that is not a listing -- and either answers it, on which
 * the page that follows confirms and the run carries on by itself, or Skips
 * the entry. Nothing is ever saved from a page that did not confirm.
 *
 * Runs in the side panel because the panel lives as long as it is open and
 * the service worker does not: Chrome evicts an idle worker after thirty
 * seconds, and a run of fifty pages takes minutes.
 *
 * The detection budget, the pause between pages and the failure limit are
 * settings (`bulk.*` in db/settingsSchema.ts), read once when a run starts.
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
    /** The person asked for the page again; the wait starts over. */
    | { type: "retrying"; entry: UrlEntry }
    | { type: "paused" }
    | { type: "resumed" }
    | { type: "done" };

/** What the person decided about the entry in flight while the run waited on them. */
export type Verdict = "skip" | "retry";

/**
 * The buttons' side of a run. Pause takes effect between listings -- the one
 * in flight finishes first, so a save is never left half done -- Skip gives
 * up on the listing in flight, Retry loads its page again, and Cancel takes
 * effect at once, including while paused or waiting.
 */
export class BulkControl {
    readonly #abort = new AbortController();
    #entry: AbortController | null = null;
    #verdict: Verdict | null = null;
    #paused = false;
    #resume: (() => void) | null = null;

    get signal(): AbortSignal {
        return this.#abort.signal;
    }

    get paused(): boolean {
        return this.#paused;
    }

    get cancelled(): boolean {
        return this.#abort.signal.aborted;
    }

    /** The signal for one entry's wait: it ends on Cancel, Skip and Retry. */
    beginEntry(): AbortSignal {
        this.#entry = new AbortController();
        this.#verdict = null;
        return AbortSignal.any([this.#abort.signal, this.#entry.signal]);
    }

    /** What ended the entry's wait, when the person did. */
    get verdict(): Verdict | null {
        return this.#verdict;
    }

    /** Gives up on the entry in flight; the run moves on to the next. */
    skip(): void {
        this.#verdict = "skip";
        this.#entry?.abort();
    }

    /** Loads the entry's page again and waits for it afresh. */
    retry(): void {
        this.#verdict = "retry";
        this.#entry?.abort();
    }

    pause(): void {
        this.#paused = true;
    }

    resume(): void {
        this.#paused = false;
        this.#resume?.();
        this.#resume = null;
    }

    cancel(): void {
        this.#abort.abort();
        this.#resume?.();
        this.#resume = null;
    }

    /** Parks the run while paused. Returns whether it actually waited. */
    async waitWhilePaused(): Promise<boolean> {
        if (!this.#paused || this.cancelled) return false;
        await new Promise<void>((resolve) => {
            this.#resume = resolve;
        });
        return true;
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

    /** The tab the run drives; a Retry may have to open another if the user closed it. */
    const tab = { id: await tabBesideThePanel() };
    let consecutiveFailures = 0;

    // Where the tab's document is, once a navigation has committed: null
    // while the page asked for is still on its way. A site may send the tab
    // somewhere other than the entry's URL (Zillow redirects a building named
    // by its coordinates to its keyed page), and the page it lands on is the
    // one to take; the URL at commit is how that page is told from the one
    // being left, which keeps answering for itself for a while.
    const landed = { url: null as string | null };
    const onUpdated = (updated: number, change: { url?: string }): void => {
        if (updated === tab.id && change.url) landed.url = change.url;
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    const fail = (entry: UrlEntry, reason: string): void => {
        progress.failed.push({ url: entry.url, reason });
        consecutiveFailures += 1;
        emit({ type: "result", entry, outcome: "failed", reason });
    };

    try {
        for (const [index, entry] of entries.entries()) {
            if (control.paused) {
                emit({ type: "paused" });
                if (await control.waitWhilePaused()) emit({ type: "resumed" });
            }
            if (signal.aborted) throw new Cancelled();
            if (consecutiveFailures >= limits.maxConsecutiveFailures) {
                progress.stopped = "failures";
                break;
            }

            emit({ type: "loading", entry, index });
            landed.url = null;
            tab.id = await navigateTab(tab.id, entry.url);

            const outcome = await saveOnce(tab, entry, limits.detectTimeoutMs, control, emit, landed);
            if (outcome.ok) {
                consecutiveFailures = 0;
                if (outcome.outcome === "saved") progress.saved += 1;
                else progress.unchanged += 1;
                emit({ type: "result", entry, outcome: outcome.outcome, ref: outcome.ref });
            } else {
                fail(entry, outcome.reason);
            }

            progress.done += 1;
            if (progress.done < entries.length) await delay(limits.paceMs, signal);
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

/**
 * One entry, start to finish: wait for the tab to confirm *this* listing,
 * then have the worker save it. The save is checked the same way -- the
 * worker refuses a page that answers for any other listing -- and gets one
 * more try after a fresh confirmation, for a page that reloaded itself
 * between confirming and being asked. A Retry while waiting loads the page
 * again and starts the wait over, with a fresh budget.
 */
async function saveOnce(tab: { id: number | null }, entry: UrlEntry, detectTimeoutMs: number, control: BulkControl, emit: (event: BulkEvent) => void, landed: { url: string | null }): Promise<SaveResult> {
    let deadline = Date.now() + detectTimeoutMs;
    let lastFailure = "no listing was confirmed on the page";

    for (let attempt = 0; attempt < 2; attempt++) {
        const tabId = tab.id!;
        const seen = await waitForDetection(tabId, entry, deadline, control, emit, landed);
        if (seen.verdict === "retry") {
            emit({ type: "retrying", entry });
            landed.url = null;
            tab.id = await navigateTab(tabId, entry.url);
            deadline = Date.now() + detectTimeoutMs;
            attempt = -1;
            continue;
        }
        if (!seen.confirmed) return { ok: false, reason: seen.verdict === "skip" ? `${seen.reason}; skipped` : seen.reason };

        const response = await sendToWorker<SaveTabResponse>({ type: "save-tab", tabId, expect: seen.confirmed });
        if (response?.outcome === "saved" || response?.outcome === "unchanged") return { ok: true, outcome: response.outcome, ref: seen.confirmed };

        // The page that confirmed is not the one that answered, or nothing
        // answered at all. Listen for it again.
        lastFailure =
            !response ? "the extension did not answer"
            : response.outcome === "other" ? "the page answered for a different listing"
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
    /** What the person decided while the run waited on them, when they did. */
    verdict: Verdict | null;
}

/** How often the loading tab is asked what it shows. */
const POLL_MS = 500;

/**
 * Asks the tab until it confirms `entry`'s listing. Only an answer from the
 * page at the wanted URL counts: the page being left keeps answering for
 * itself for a while after the next navigation is requested, and taking its
 * word for the next page's once saved every listing one slot late. The one
 * other answer that counts is from the page the tab has landed on when the
 * site sent it elsewhere: it confirms its own listing, at the URL the
 * navigation committed to. A page that has not confirmed by `deadline`
 * makes the run say so and wait on the person at the tab, until the page
 * confirms, they Skip or Retry, or they Cancel.
 */
async function waitForDetection(tabId: number, entry: UrlEntry, deadline: number, control: BulkControl, emit: (event: BulkEvent) => void, landed: { url: string | null }): Promise<Seen> {
    const wanted = entry.ref;
    let reason = "no listing was confirmed on the page";
    const accept = (response: StatusResponse | undefined): ListingRef | null => {
        if (response?.source !== wanted.source) return null;
        if (response.subject === wanted.sourceId) {
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
        if (first) return { confirmed: first, reason, verdict: null };
        emit({ type: "waiting", entry, reason });
        const later = await pollTab<StatusResponse, ListingRef>(tabId, { type: "status" }, accept, { deadline: Infinity, every: POLL_MS, signal });
        return { confirmed: later, reason, verdict: null };
    } catch (error) {
        // A tab the user closed confirms nothing; the next entry opens another.
        if (error instanceof TabClosed) return { confirmed: null, reason: "the tab was closed", verdict: null };
        if (error instanceof Cancelled && !control.cancelled) return { confirmed: null, reason, verdict: control.verdict };
        throw error;
    }
}
