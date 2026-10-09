import { headlinePrice } from "../db/types";
import type { SourceId } from "../sources/descriptors";
import { isMessage, type ExtractResponse, type SearchResponse, type StatusResponse } from "../lib/messages";
import { log, LogLevels } from "../lib/logging";
import { installDebugHandle } from "../lib/debug";
import type { SearchResult, SourcePage } from "../sources/contract";
import { describeSignals, detectListing, type Detection } from "./detect";

/**
 * What every source's content script does, given its SourcePage: answer
 * questions about the page. It never speaks first and never touches
 * storage; the database lives in the extension origin, read by the side
 * panel and written by the service worker.
 *
 *   status    is this document a confirmed listing, and which? Detection
 *             runs afresh on every ask: on a single-page site the document
 *             catches up with its URL a beat late, and the panel asks again
 *             until it has. The payload parse is cached per block
 *             (zillow/page/hydration.ts), so a repeat ask is cheap.
 *   extract   everything the page says about its listing, for a save.
 *   search    the result list, when this is one of the site's search pages.
 *
 * A script may be injected more than once into one document: by the
 * registration and by the worker's catch-up injection, and again after the
 * extension is reloaded. A later injection in the same isolated world
 * replaces the earlier instance's listener; a global names it. An instance
 * orphaned by a reload lives in a world this one cannot reach, but it holds
 * no timers and no observers, and its dead runtime delivers it no messages,
 * so it is inert.
 */

const INSTANCE_KEY = "__intelContentScript";

interface Instance {
    dispose(): void;
}

export function runContentScript(page: SourcePage): void {
    const source = page.descriptor.id as SourceId;
    const global = globalThis as Record<string, unknown>;
    const previous = global[INSTANCE_KEY] as Instance | undefined;
    previous?.dispose();

    /** One look at the page: what the URL names, and whether the document agrees. */
    function status(): StatusResponse {
        const url = location.href;
        let detection: Detection | null = null;
        try {
            detection = detectListing(page, document, url);
        } catch (error) {
            // A redesign that breaks one probe must not take the script down.
            log(LogLevels.WARN, "detect threw", error);
        }
        const subject = detection?.urlRef?.sourceId ?? page.descriptor.urls.parse(url)?.sourceId ?? null;
        let listing: StatusResponse["listing"] = null;
        if (detection?.confirmed && detection.subject) {
            // Price only, so the panel can tell "saved" from "update" without a save.
            let capture = null;
            try {
                capture = page.extract(document, url, detection.subject);
            } catch (error) {
                log(LogLevels.WARN, "extract threw", error);
            }
            listing = {
                ref: { source, sourceId: detection.subject },
                kind: capture?.kind ?? detection.urlRef?.kind ?? null,
                price: capture ? headlinePrice(capture.core) : null,
            };
        }
        return { type: "status-response", source, url, subject, listing, detail: detection && !listing ? describeSignals(detection) : null, challenge: listing ? null : challengeOn(url) };
    }

    /** The site's check that the visitor is a person, when this page is one. */
    function challengeOn(url: string): string | null {
        try {
            return page.challenge?.(document, url) ?? null;
        } catch (error) {
            log(LogLevels.WARN, "challenge threw", error);
            return null;
        }
    }

    /** Whether this document's own search box has been driven (see `search` below), and what that came to. */
    let searchDriven = false;
    let searchDriveNote: string | null = null;
    let searchDriveAsked = false;

    function search(query: string): SearchResponse {
        let results: SearchResult[] | null = null;
        let failure: string | null = null;
        let nextUrl: string | null = null;
        try {
            results = page.searchResults?.(document, location.href) ?? null;
            if (results === null) failure = page.searchFailure?.(document, location.href) ?? null;
            else nextUrl = page.searchNextUrl?.(document, location.href) ?? null;
        } catch (error) {
            log(LogLevels.WARN, "searchResults threw", error);
        }
        // Not a search page and not a dead end: a site that resolves text
        // itself is asked through its own box, once per document. The page
        // that follows answers the next ask.
        if (results === null && failure === null && page.driveSearch && !searchDriven) {
            searchDriven = true;
            page.driveSearch(document, location.href, query).then(
                (result) => {
                    // No box yet, or a drive that got nowhere: try again on the next ask.
                    searchDriveAsked = result?.asked ?? false;
                    if (!searchDriveAsked) searchDriven = false;
                    searchDriveNote = result?.note ?? "no search box on this page yet";
                    log(LogLevels.MSGS, "driveSearch ->", searchDriveNote);
                },
                (error) => {
                    searchDriveNote = `driving the box threw: ${String(error)}`;
                    log(LogLevels.WARN, "driveSearch threw", error);
                },
            );
        }
        const challenge = results === null && failure === null ? challengeOn(location.href) : null;
        return {
            type: "search-response",
            source,
            url: location.href,
            results,
            ...(nextUrl ? { nextUrl } : {}),
            driving: searchDriven && results === null,
            ...(searchDriveNote ? { driveNote: searchDriveNote, driveAsked: searchDriveAsked } : {}),
            ...(failure ? { failure } : {}),
            ...(challenge ? { challenge } : {}),
        };
    }

    // Every answer is read synchronously: the askers poll, and a page that is
    // not ready yet is simply asked again.
    const onMessage = (raw: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean => {
        if (!isMessage(raw)) return false;
        switch (raw.type) {
            case "status": {
                const response = status();
                log(LogLevels.MSGS, "status ->", response.listing ? `listing ${response.listing.ref.sourceId}` : response.subject ? "unconfirmed" : "not a listing URL");
                sendResponse(response);
                return false;
            }
            case "extract": {
                let capture = null;
                try {
                    const { subject } = detectListing(page, document, location.href);
                    // A forced parse needs only a subject: the user asked, and
                    // the URL or a probe's claim says what the page is about.
                    if (subject) capture = page.extract(document, location.href, subject);
                } catch (error) {
                    log(LogLevels.WARN, "extract threw", error);
                }
                const response: ExtractResponse = { type: "extract-response", source, capture };
                log(LogLevels.MSGS, "extract ->", capture ? "captured" : "nothing");
                sendResponse(response);
                return false;
            }
            case "search": {
                const response = search(raw.query);
                log(LogLevels.MSGS, "search ->", response.results ? `${response.results.length} results` : (response.failure ?? "not a search page"));
                sendResponse(response);
                return false;
            }
            default:
                return false;
        }
    };
    chrome.runtime.onMessage.addListener(onMessage);

    const instance: Instance = {
        dispose() {
            try {
                chrome.runtime.onMessage.removeListener(onMessage);
            } catch {
                // The runtime is gone with the extension that installed it.
            }
            if (global[INSTANCE_KEY] === instance) delete global[INSTANCE_KEY];
        },
    };
    global[INSTANCE_KEY] = instance;

    installDebugHandle();
    log(LogLevels.INFO, `${source} content script`, location.href, previous ? "(replaced the instance before it)" : "");
}
