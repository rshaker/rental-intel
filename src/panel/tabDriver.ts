import { sendToTab, type Message } from "../lib/messages";

/**
 * The tab the panel drives through pages: the user's own, the one beside
 * the panel. The bulk loader walks it through a URL list; the Search tab's
 * runner sends it to a site's search page. Both live in the panel rather
 * than the worker because a page can take longer to arrive than the thirty
 * idle seconds Chrome gives a worker.
 *
 * Why the user's own tab and not a hidden one: the extension needs a person
 * beside it. Nothing here fetches, since nothing but a browser showing a
 * page to a person gets past the sites' bot detection; a hidden tab gets no
 * animation frames and slow timers, and apartments.com draws its
 * suggestions in neither; and when a site does put up a check, the person
 * sees it, answers it, and the run carries on from the page that follows.
 * Nothing here is told anything: the tab is asked, again and again, until
 * its page answers.
 */

/**
 * The tab the panel sits beside: the active one in its window. Null -- so a
 * fresh tab is opened -- when that is this panel itself, which happens when
 * the panel is opened as a tab of its own (a test, a curious user).
 */
export async function tabBesideThePanel(): Promise<number | null> {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const self = await chrome.tabs.getCurrent().catch(() => undefined);
    if (active?.id === undefined || (self?.id !== undefined && active.id === self.id)) return null;
    return active.id;
}

/** Sends the tab to `url`, opening a fresh one, in front, if there is none or the user closed it. */
export async function navigateTab(tabId: number | null, url: string): Promise<number> {
    if (tabId !== null) {
        try {
            await chrome.tabs.update(tabId, { url });
            return tabId;
        } catch {
            // The tab is gone. Carry on in another rather than give up.
        }
    }
    // Opened blank and then navigated, rather than opened on the URL: the tab
    // exists before its first listing request goes out, so anything watching
    // the tab (a debugger, a test's request routing) sees that request. A page
    // opened straight onto a URL has its request in flight before anyone can
    // attach to it.
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    if (tab.id === undefined) throw new Error("Chrome opened a tab without an id");
    await chrome.tabs.update(tab.id, { url });
    return tab.id;
}

/** Thrown out of a wait that an AbortSignal cut short. */
export class Cancelled extends Error {}

/** Thrown out of a poll whose tab the user closed. */
export class TabClosed extends Error {}

/** Waits `ms`, or rejects with Cancelled the moment `signal` aborts. */
export function delay(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new Cancelled());
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

export interface PollOptions {
    /** When to stop asking, as a `Date.now()` value; Infinity to ask until the signal says stop. */
    deadline: number;
    /** How long between asks. */
    every: number;
    signal: AbortSignal;
}

/**
 * Asks the tab `message` every `every` ms until `accept` makes something of
 * an answer, and returns that; null when the deadline passes first. A tab
 * with no script yet answers undefined, which `accept` sees too, so a
 * caller can tell silence from a page that is not ready. Throws Cancelled
 * when the signal aborts and TabClosed when the tab goes away.
 */
export async function pollTab<R, T>(tabId: number, message: Message, accept: (response: R | undefined) => T | null | undefined, { deadline, every, signal }: PollOptions): Promise<T | null> {
    let closed = false;
    const onRemoved = (removed: number): void => {
        if (removed === tabId) closed = true;
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    try {
        for (;;) {
            if (signal.aborted) throw new Cancelled();
            if (closed) throw new TabClosed();
            const found = accept(await sendToTab<R>(tabId, message));
            if (found !== null && found !== undefined) return found;
            const left = deadline - Date.now();
            if (left <= 0) return null;
            await delay(Math.min(every, left), signal);
        }
    } finally {
        chrome.tabs.onRemoved.removeListener(onRemoved);
    }
}
