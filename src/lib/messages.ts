import type { ListingCapture, ListingKind, ListingRef } from "../db/types";
import type { SearchResult } from "../sources/contract";
import type { SourceId } from "../sources/descriptors";

/**
 * The wire protocol between contexts. Content scripts answer and never speak
 * first; the worker broadcasts to the extension pages when photos arrive or a
 * warning was logged. Every message is a discriminated union member.
 */

/** Panel or bulk loader -> content script: what does this page show? Asked again on a schedule while a listing URL is unconfirmed. */
export interface StatusRequest {
    type: "status";
}

export interface StatusResponse {
    type: "status-response";
    source: SourceId;
    /** Where the document is: a page being left still answers for itself. */
    url: string;
    /** The listing the URL names, when it names one. */
    urlListingId: string | null;
    /** The confirmed listing: present only when the page agrees with the URL. The price alone tells "saved" from "update". */
    listing: { ref: ListingRef; kind: ListingKind | null; price: number | null } | null;
    /** What the checks said when the page did not confirm, for the activity log. */
    detail: string | null;
    /** The site's check that the visitor is a person, when the page is one. */
    challenge: string | null;
}

export interface ExtractRequest {
    type: "extract";
}

export interface ExtractResponse {
    type: "extract-response";
    source: SourceId;
    capture: ListingCapture | null;
}

/** Panel -> content script: the result list, if this is a search page. Asked again until the page answers. */
export interface SearchRequest {
    type: "search";
    /** What is being searched for, for a source that submits the site's own box. */
    query: string;
}

export interface SearchResponse {
    type: "search-response";
    source: SourceId;
    /** Where the tab ended up: a site may redirect a search. */
    url: string;
    /** Null while the page is not, or not yet, a search page. */
    results: SearchResult[] | null;
    nextUrl?: string;
    /** The script has put the query into the site's own search box; the results page is on its way. */
    submitting?: boolean;
    /** What submitting the box came to, once known. */
    submitNote?: string;
    submitted?: boolean;
    /** This page will never become a search page, and why. */
    failure?: string;
    challenge?: string;
}

/** Panel -> worker: save whatever listing this tab is showing. With `expect`, a page answering for any other listing is not saved. */
export interface SaveTab {
    type: "save-tab";
    tabId: number;
    expect?: ListingRef;
}

/** `no-listing`: the page yielded none, or no source's script runs on it. `unreachable`: a granted source's page took no script. `different-listing`: the page answered for a listing other than `expect`. */
export type SaveOutcome = "saved" | "unchanged" | "no-listing" | "unreachable" | "different-listing";

export interface SaveTabResponse {
    type: "save-tab-response";
    outcome: SaveOutcome;
    listingId?: string;
    ref?: ListingRef;
    /** The save read only the page's layout; the record is thinner than it could be. */
    partial?: boolean;
    photos?: number;
}

/** Any context -> the panel's activity log: a warning or error, so a problem is visible without DevTools. */
export interface LogLine {
    type: "log-line";
    level: "warn" | "error";
    context: string;
    text: string;
}

/** Worker -> extension pages: a listing's photos are arriving. Sent every few photos and once more when the last has landed. */
export interface PhotosProgress {
    type: "photos-progress";
    listingId: string;
    done: number;
    total: number;
}

export type Message = StatusRequest | StatusResponse | ExtractRequest | ExtractResponse | SearchRequest | SearchResponse | SaveTab | SaveTabResponse | LogLine | PhotosProgress;

export function isMessage(value: unknown): value is Message {
    return typeof value === "object" && value !== null && typeof (value as Message).type === "string";
}

/** Sends to the service worker; undefined when nothing answered. */
export async function sendToWorker<T = unknown>(message: Message): Promise<T | undefined> {
    try {
        return (await chrome.runtime.sendMessage(message)) as T;
    } catch {
        return undefined;
    }
}

/** Broadcasts to every extension page. */
export function broadcast(message: Message): void {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/** Asks one tab's content script; undefined when none is listening, which is the normal case on a tab of any other site. */
export async function sendToTab<T = unknown>(tabId: number, message: Message): Promise<T | undefined> {
    try {
        return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch {
        return undefined;
    }
}
