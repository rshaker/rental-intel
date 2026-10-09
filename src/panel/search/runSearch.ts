import { getSettings } from "../../db/settings";
import type { SearchResponse } from "../../lib/messages";
import type { SearchFilters, SearchResult, SourceDescriptor } from "../../sources/contract";
import { anySet } from "../../sources/shared/filters";
import { Cancelled, TabClosed, delay, navigateTab, pollTab, tabBesideThePanel } from "../tabDriver";
import { resolveSearchUrl } from "./searchUrl";

/**
 * One search of one site, start to finish, in the tab beside the panel: the
 * site's search page is opened there, the site renders it the way it would
 * for a person, and that site's content script reads the result list off
 * the rendered document. The extension never fetches the page itself, for
 * the reason bulk/bulkLoad.ts gives: nothing but a browser showing a page
 * gets past the sites' bot detection. And it is the user's own tab rather
 * than a hidden one because a hidden tab gets no animation frames and slow
 * timers, and apartments.com draws its suggestions in neither; a visible
 * tab also keeps the panel, which is per tab, in view. The run ends with
 * the results page in the tab, which is where a result's link goes next,
 * and Back returns.
 *
 * The tab is asked every POLL_MS until it answers with a list. Three things
 * look the same from here and all mean "ask again": no content script yet
 * (a redirect in flight -- Zillow sends a free-text search through one --
 * or a document before document_idle), a script whose page is not a search
 * page, and a search page whose list has not rendered. A site that
 * resolves text itself (apartments.com) is opened on its home page and its
 * script drives the site's own search box; the page that follows answers a
 * later poll. A page that will never answer (the site's "not found" page)
 * says so, and the run ends there.
 *
 * A page that has answered nothing by the deadline does not end the run:
 * a person is looking at the tab. The status says so -- naming the site's
 * check when the page is one -- and the asking goes on until the page
 * answers, which it does by itself once the person has dealt with whatever
 * the tab shows, or until Cancel.
 *
 * Filters come second. The text is searched bare first, because only the
 * site knows what page a place has; the page it settles on is then handed
 * to the source, which names the same search with the filters applied
 * (`filteredUrl`), and the tab is sent there. That page is the first one
 * read. Text that is already a URL is used as it is, filters and all: it
 * says what it wants.
 *
 * A site that splits its results over pages (apartments.com: 40 to a page)
 * is walked through them: each page's script names the next, the tab is
 * sent there after a pause, and the lists are joined, a listing the site
 * repeats counted once. Every page gets the same budget as the first. A
 * later page that never answers, a closed tab or Cancel ends the walk with
 * what was read so far, and the outcome says it stopped short.
 *
 * Nothing is asked until the tab has started loading the search page: the
 * page being left may be a search page of its own, and would answer for
 * itself. Runs in the panel, as the bulk loader does, because a run can
 * outlast an idle worker.
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
    say(`opened ${url} in the tab beside the panel`);

    /** Asks the tab until a page not read yet answers with its list; past the deadline, waits on the person at the tab. */
    const readPage = async (read: ReadonlySet<string>, until: number): Promise<PageAnswer> => {
        let answered: string | null = null;
        let driving = false;
        let driveNote: string | null = null;
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
            if (response.driving && !driving) {
                driving = true;
                say("the script is driving the site's own search box");
                onStatus?.("Searching on the site…");
            }
            if (response.driveNote && response.driveNote !== driveNote) {
                driveNote = response.driveNote;
                say(driveNote);
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
            await delay(paceSeconds * 1000, signal);
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
                await delay(paceSeconds * 1000, signal);
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

/**
 * Sends the tab beside the panel to `url` and waits for it to start loading,
 * or a few seconds, whichever is first: the page being left may be a search
 * page of its own and would answer for itself. Listening before the
 * navigation is asked for, since the tab can start loading before the call
 * to navigate it returns.
 */
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
        const tabId = await navigateTab(await tabBesideThePanel(), url);
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
