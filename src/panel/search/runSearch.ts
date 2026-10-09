import { getSettings } from "../../db/settings";
import type { SearchResponse } from "../../lib/messages";
import type { SearchFilters, SearchResult, SourceDescriptor } from "../../sources/contract";
import { anySet } from "../../sources/shared/filters";
import { Cancelled, sleep } from "../../lib/poll";
import { TabClosed, activeTabId, navigateTab, pollTab } from "../tabDriver";
import { resolveSearchUrl } from "./searchUrl";

/**
 * One search of one site, start to finish, in the active tab: the site's
 * search page is opened there and the site's content script reads the result
 * list off the rendered document, asked every POLL_MS until it answers. A
 * site that resolves text itself (apartments.com) is opened on its home page
 * and its script submits the site's own box. Past the deadline the run waits
 * on the person at the tab rather than giving up. The text is searched bare
 * first, then the same search with the form's filters applied; a pasted URL
 * is used as it is. Further pages of results are walked and joined.
 */

const POLL_MS = 750;
/** How long to wait for the tab to begin loading before asking it anyway. */
const NAVIGATION_WAIT_MS = 3_000;

export type SearchOutcome =
    | { ok: true; url: string; results: SearchResult[]; pages: number; /** Why the walk through the pages stopped before the last, when it did. */ stopped?: string }
    | { ok: false; reason: "no-url"; url: null }
    | { ok: false; reason: "failed"; url: string; message: string }
    | { ok: false; reason: "cancelled" | "closed"; url: string };

/** What asking the tab for one page of results came to. */
type PageAnswer = { kind: "results"; url: string; results: SearchResult[]; nextUrl: string | null } | { kind: "failed"; url: string; message: string } | { kind: "closed" };

export interface RunSearchOptions {
    signal: AbortSignal;
    /** What the run is doing, for a status line. */
    onStatus?: (text: string) => void;
    /** What happened when, for the activity log: where a slow run spent its time. */
    onLine?: (text: string) => void;
    /** What the form's filters are set to. Not applied to text that is a URL. */
    filters?: SearchFilters;
}

export async function runSearch(source: SourceDescriptor, query: string, { signal, onStatus, onLine, filters }: RunSearchOptions): Promise<SearchOutcome> {
    const url = resolveSearchUrl(source, query);
    if (!url) return { ok: false, reason: "no-url", url: null };
    const started = Date.now();
    const at = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;
    const say = (text: string): void => onLine?.(`${source.label} search: ${text} (${at()})`);

    // The same budget a bulk-loaded page gets to confirm itself.
    const settings = await getSettings();
    const waitedSeconds = settings["bulk.detectTimeout"];
    const maxPages = settings["search.maxPages"];
    const paceSeconds = settings["search.pace"];
    const deadline = Date.now() + waitedSeconds * 1000;
    if (signal.aborted) return { ok: false, reason: "cancelled", url };

    onStatus?.(`Opening ${new URL(url).hostname}…`);
    const tabId = await openAndWaitForLoading(url);
    say(`opened ${url} in the active tab`);

    /** Asks the tab until a page not read yet answers with its list; past the deadline, waits on the person at the tab. */
    const readPage = async (read: ReadonlySet<string>, until: number): Promise<PageAnswer> => {
        let answered: string | null = null;
        let submitting = false;
        let submitNote: string | null = null;
        let challenge: string | null = null;
        const accept = (response: SearchResponse | undefined): PageAnswer | null => {
            // The page being left still answers for itself until the next one arrives.
            if (response?.type !== "search-response" || read.has(response.url)) return null;
            if (answered !== response.url) {
                answered = response.url;
                say(`the page's script answered from ${response.url}`);
            }
            if (Array.isArray(response.results)) return { kind: "results", url: response.url, results: response.results, nextUrl: response.nextUrl ?? null };
            if (response.failure) return { kind: "failed", url: response.url, message: response.failure };
            if (response.challenge && response.challenge !== challenge) {
                challenge = response.challenge;
                say(challenge);
                onStatus?.(challenge);
            }
            if (response.submitting && !submitting) {
                submitting = true;
                say("the script is submitting the site's own search box");
                onStatus?.("Searching on the site…");
            }
            if (response.submitNote && response.submitNote !== submitNote) {
                submitNote = response.submitNote;
                say(submitNote);
            }
            return null;
        };
        try {
            const page = await pollTab<SearchResponse, PageAnswer>(tabId, { type: "search", query }, accept, { deadline: until, every: POLL_MS, signal });
            if (page) return page;
            // Nothing by the deadline. A person is looking at the tab: say so, and wait for them.
            say(answered ? `nothing by the deadline; the tab is on ${answered}; waiting on you` : "nothing by the deadline; no page's script has answered; waiting on you");
            onStatus?.(challenge ?? `Nothing yet after ${waitedSeconds}s. If the site is asking you to prove you are a person, answer it in the tab; the search carries on when the page loads.`);
            return (await pollTab<SearchResponse, PageAnswer>(tabId, { type: "search", query }, accept, { deadline: Infinity, every: POLL_MS, signal }))!;
        } catch (error) {
            if (error instanceof TabClosed) return { kind: "closed" };
            throw error;
        }
    };

    /** A page that did not answer with a list, as the run's outcome. */
    const ended = (page: Exclude<PageAnswer, { kind: "results" }>): SearchOutcome => {
        if (page.kind === "closed") return { ok: false, reason: "closed", url };
        return { ok: false, reason: "failed", url: page.url, message: page.message };
    };

    try {
        onStatus?.("Waiting for results…");
        let first = await readPage(new Set(), deadline);
        if (first.kind !== "results") return ended(first);
        const read = new Set([first.url]);

        // The site has settled on a page for the text; now the same search, filtered.
        const filtered = filters && anySet(filters) && !/^https?:\/\//i.test(query.trim()) ? (source.search?.filteredUrl?.(first.url, filters) ?? null) : null;
        if (filtered && filtered !== first.url) {
            say(`the site's page for “${query}” is ${first.url}`);
            onStatus?.("Applying the filters…");
            await sleep(paceSeconds * 1000, signal);
            try {
                await chrome.tabs.update(tabId, { url: filtered });
            } catch {
                return { ok: false, reason: "closed", url };
            }
            say(`opened it with the filters, ${filtered}`);
            first = await readPage(read, Date.now() + waitedSeconds * 1000);
            if (first.kind !== "results") return ended(first);
            read.add(filtered).add(first.url);
        }
        say(`${first.results.length} results read`);

        const results = [...first.results];
        const listed = new Set(results.map((result) => result.url));
        let pages = 1;
        let next = first.nextUrl;
        let stopped: string | null = null;
        try {
            while (next && !read.has(next)) {
                if (maxPages > 0 && pages >= maxPages) {
                    stopped = `the limit of ${maxPages} pages`;
                    break;
                }
                onStatus?.(`Reading page ${pages + 1}… (${results.length} so far)`);
                await sleep(paceSeconds * 1000, signal);
                await chrome.tabs.update(tabId, { url: next });
                say(`opened page ${pages + 1}, ${next}`);
                const page = await readPage(read, Date.now() + waitedSeconds * 1000);
                if (page.kind !== "results") {
                    stopped = page.kind === "closed" ? "the tab was closed" : page.message;
                    break;
                }
                read.add(next).add(page.url);
                pages++;
                const fresh = page.results.filter((result) => !listed.has(result.url));
                for (const result of fresh) listed.add(result.url);
                results.push(...fresh);
                say(`${fresh.length} more results read from page ${pages}, ${results.length} in all`);
                next = page.nextUrl;
            }
        } catch (error) {
            // Cancel, or a tab that went away mid-walk: what was read is still an answer.
            stopped = error instanceof Cancelled ? "cancelled" : "the tab was closed";
        }
        if (stopped) say(`stopped after page ${pages}: ${stopped}`);
        return { ok: true, url: first.url, results, pages, ...(stopped ? { stopped } : {}) };
    } catch (error) {
        if (error instanceof Cancelled) return { ok: false, reason: "cancelled", url };
        throw error;
    }
}

/** Sends the active tab to `url` and waits for it to start loading, or a few seconds: the page being left may be a search page of its own and would answer for itself. */
async function openAndWaitForLoading(url: string): Promise<number> {
    const loadingTabs = new Set<number>();
    let wanted: number | null = null;
    let onLoading: (() => void) | null = null;
    const onUpdated = (updated: number, change: { status?: string }): void => {
        if (change.status !== "loading") return;
        loadingTabs.add(updated);
        if (updated === wanted) onLoading?.();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    try {
        const tabId = await navigateTab(await activeTabId(), url);
        wanted = tabId;
        if (!loadingTabs.has(tabId)) {
            await new Promise<void>((resolve) => {
                onLoading = resolve;
                setTimeout(resolve, NAVIGATION_WAIT_MS);
            });
        }
        return tabId;
    } finally {
        chrome.tabs.onUpdated.removeListener(onUpdated);
    }
}
