import { sendToTab, type Message } from "../lib/messages";
import { poll, type PollOptions } from "../lib/poll";

/**
 * The tab the panel drives through pages: the user's own active tab. The
 * URL-list loader and the Search tab both send it to a page and then ask it,
 * again and again, until its content script answers. They live in the panel
 * rather than the worker because a page can take longer to arrive than the
 * idle time Chrome gives a worker.
 */

/** The active tab in the panel's window, or null when that is the panel itself (opened as a tab of its own). */
export async function activeTabId(): Promise<number | null> {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    const self = await chrome.tabs.getCurrent().catch(() => undefined);
    if (active?.id === undefined || (self?.id !== undefined && active.id === self.id)) return null;
    return active.id;
}

/** Sends the tab to `url`, opening a fresh one in front when there is none or the user closed it. */
export async function navigateTab(tabId: number | null, url: string): Promise<number> {
    if (tabId !== null) {
        try {
            await chrome.tabs.update(tabId, { url });
            return tabId;
        } catch {
            // The tab is gone. Carry on in another.
        }
    }
    // Opened blank and then navigated, so anything watching the tab (a test's request routing) sees its first request.
    const tab = await chrome.tabs.create({ url: "about:blank", active: true });
    if (tab.id === undefined) throw new Error("Chrome opened a tab without an id");
    await chrome.tabs.update(tab.id, { url });
    return tab.id;
}

/** Thrown out of a poll whose tab the user closed. */
export class TabClosed extends Error {}

/** Asks the tab `message` until `accept` makes something of an answer; null when the deadline passes first. A tab with no script yet answers undefined. Throws Cancelled on abort and TabClosed when the tab goes away. */
export async function pollTab<R, T>(tabId: number, message: Message, accept: (response: R | undefined) => T | null | undefined, options: PollOptions): Promise<T | null> {
    let closed = false;
    const onRemoved = (removed: number): void => {
        if (removed === tabId) closed = true;
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    try {
        return await poll(
            async () => {
                if (closed) throw new TabClosed();
                return sendToTab<R>(tabId, message);
            },
            accept,
            options,
        );
    } finally {
        chrome.tabs.onRemoved.removeListener(onRemoved);
    }
}
