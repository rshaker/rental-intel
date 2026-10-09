import type { ListingCapture, ListingKind, ListingRef } from "../db/types";
import type { SearchResult } from "../sources/contract";
import type { SourceId } from "../sources/descriptors";
import { log, LogLevels } from "./logging";

/**
 * The wire protocol between contexts. Content scripts answer questions and
 * never speak first: the side panel asks the active tab what it shows, the
 * bulk loader and the Search tab ask the tab they drive, the worker asks for
 * a capture. The worker broadcasts to the extension pages when a save has
 * landed, photos are arriving, or a warning was logged.
 *
 * Every message is a discriminated union member, so `switch (msg.type)` in a
 * handler is exhaustively checkable.
 */

// ---------------------------------------------------------------------------
// To a content script
// ---------------------------------------------------------------------------

/**
 * What does this page show? The panel asks the active tab, again on a
 * schedule while a listing URL is unconfirmed, since a single-page site's
 * document catches up with its URL a beat late; the bulk loader asks the
 * tab it drives the same way.
 */
export interface StatusRequest {
    type: "status";
}

export interface StatusResponse {
    type: "status-response";
    source: SourceId;
    /** Where the document is: a page being left still answers for itself. */
    url: string;
    /** The listing the URL names, when it names one. */
    subject: string | null;
    /** The confirmed listing: present only when the page agrees with the URL. The price alone tells "saved" from "update". */
    listing: { ref: ListingRef; kind: ListingKind | null; price: number | null } | null;
    /** What the probes said when the page did not confirm, for the activity log. */
    detail: string | null;
    /** The site's check that the visitor is a person, when the page is one: a sentence for the person at the tab. */
    challenge: string | null;
}

/** Worker -> content script: hand over everything you can read off this page. */
export interface ExtractRequest {
    type: "extract";
}

/** Content script -> worker, in reply to ExtractRequest. */
export interface ExtractResponse {
    type: "extract-response";
    source: SourceId;
    capture: ListingCapture | null;
}

/**
 * Side panel -> content script: read the result list off this page, if it is
 * one of the site's search pages. The Search tab's runner asks it of the tab
 * it drives, again and again until the page answers.
 */
export interface SearchRequest {
    type: "search";
    /** What is being searched for, for a source that drives the site's own box. */
    query: string;
}

/**
 * Content script -> side panel, in reply to SearchRequest. `url` is where
 * the tab ended up: a site may redirect a search to its canonical page.
 * `results` is null while the page is not, or not yet, a search page.
 */
export interface SearchResponse {
    type: "search-response";
    source: SourceId;
    url: string;
    results: SearchResult[] | null;
    /** The next page of these results, when the site has one. Only beside `results`. */
    nextUrl?: string;
    /** The script has put the query into the site's own search box; the results page is on its way. */
    driving?: boolean;
    /** What driving the box came to, once known: for the activity log. */
    driveNote?: string;
    /** Whether that drive got as far as asking the site. False: the page is still where it was. */
    driveAsked?: boolean;
    /** This page will never become a search page, and why. The run should stop. */
    failure?: string;
    /** The site's check that the visitor is a person: the run should say so and wait. */
    challenge?: string;
}

// ---------------------------------------------------------------------------
// To the worker
// ---------------------------------------------------------------------------

/**
 * Side panel -> worker: save whatever listing this tab is showing. The panel's
 * capture button asks it of the active tab; the bulk loader drives a tab
 * through a list of URLs and asks it of each page once that page confirms.
 */
export interface SaveTab {
    type: "save-tab";
    tabId: number;
    /**
     * The listing the sender believes the tab is showing. When given, a page
     * that answers for any other listing is not saved: a tab that has just
     * been told to navigate may still be answering for the page it is leaving.
     */
    expect?: ListingRef;
}

/**
 * What saving a tab came to. `nothing` is a page that yielded no listing, or
 * a page no source's script runs on; `unreachable` is a granted source's
 * page that took no script and answered nothing, which a reload of the tab
 * cures; `other` is a page that answered for a listing other than the one
 * `expect` named.
 */
export type SaveOutcome = "saved" | "unchanged" | "nothing" | "unreachable" | "other";

/** Worker -> side panel, in reply to SaveTab. */
export interface SaveTabResponse {
    type: "save-tab-response";
    outcome: SaveOutcome;
    /** The listing the page belongs to. Present when the outcome is `saved` or `unchanged`. */
    listingId?: string;
    /** The same listing by source and id. */
    ref?: ListingRef;
    /** The save read only the page's layout, not the site's data; the record is thinner than it could be. */
    partial?: boolean;
    /** How many photos the worker is now fetching, after answering. Zero when none are wanted. */
    photos?: number;
}

// ---------------------------------------------------------------------------
// To every extension page
// ---------------------------------------------------------------------------

/**
 * Any context -> the side panel's activity log: a warning or error the
 * console got, so a problem on a listing page or in the worker is visible
 * without DevTools. Debug chatter never travels.
 */
export interface LogLine {
    type: "log-line";
    level: "warn" | "error";
    /** Which context said it: "zillow.com", "worker", … */
    context: string;
    text: string;
}

/**
 * Worker -> every extension page: the photos of a listing are arriving.
 * Sent every few photos, and once more when the last has landed (`done`
 * equal to `total`). The records themselves need no message: the panel's
 * live queries see every write.
 */
export interface PhotosProgress {
    type: "photos-progress";
    listingId: string;
    done: number;
    total: number;
}

export type Message = StatusRequest | StatusResponse | ExtractRequest | ExtractResponse | SearchRequest | SearchResponse | SaveTab | SaveTabResponse | LogLine | PhotosProgress;

/** Narrowing helper for `chrome.runtime.onMessage` payloads, which arrive as `any`. */
export function isMessage(value: unknown): value is Message {
    return typeof value === "object" && value !== null && typeof (value as Message).type === "string";
}

/** Fire-and-forget send to the service worker; swallows "no receiver" noise. */
export async function sendToWorker<T = unknown>(message: Message): Promise<T | undefined> {
    try {
        return (await chrome.runtime.sendMessage(message)) as T;
    } catch {
        return undefined;
    }
}

/** Broadcast to every extension page. Rejects when none is open, which is nothing. */
export function broadcast(message: Message): void {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/**
 * Ask one tab's content script for something; undefined if it isn't listening.
 *
 * The swallow is load-bearing, not noise suppression. Content scripts run only
 * on enabled sources' pages, so a tab on any other site has no receiver.
 * Returning undefined there is exactly the "silently do nothing" the panel
 * wants, both when it asks a tab and when its capture button tries one.
 */
export async function sendToTab<T = unknown>(tabId: number, message: Message): Promise<T | undefined> {
    try {
        return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (error) {
        log(LogLevels.DEBUG, "sendToTab: no receiver", tabId, error);
        return undefined;
    }
}
