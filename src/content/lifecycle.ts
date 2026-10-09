import { headlinePrice } from "../db/types";
import type { SourceId } from "../sources/descriptors";
import { isMessage, type ExtractResponse, type SearchResponse, type StatusResponse } from "../lib/messages";
import { forwardLogTo, warn } from "../lib/log";
import type { SearchResult, SourcePage } from "../sources/contract";
import { describeChecks, detectListing, manualCapture, type Detection } from "./detect";

/**
 * What every source's content script does, given its SourcePage: answer the
 * panel's and the worker's questions about the page (status, extract,
 * search). It never speaks first and never touches storage. A later
 * injection into the same document replaces the earlier instance's listener.
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

    /** What the URL names, and whether the document agrees. */
    function status(): StatusResponse {
        const url = location.href;
        let detection: Detection | null = null;
        try {
            detection = detectListing(page, document, url);
        } catch (error) {
            warn("detect threw", error);
        }
        const urlListingId = detection?.urlRef?.sourceId ?? page.descriptor.urls.parse(url)?.sourceId ?? null;
        let listing: StatusResponse["listing"] = null;
        if (detection?.confirmed && detection.listingId) {
            let capture = null;
            try {
                capture = page.extract(document, url, detection.listingId);
            } catch (error) {
                warn("extract threw", error);
            }
            listing = {
                ref: { source, sourceId: detection.listingId },
                kind: capture?.kind ?? detection.urlRef?.kind ?? null,
                price: capture ? headlinePrice(capture.core) : null,
            };
        }
        return { type: "status-response", source, url, urlListingId, listing, detail: detection && !listing ? describeChecks(detection) : null, challenge: listing ? null : challengeOn(url) };
    }

    function challengeOn(url: string): string | null {
        try {
            return page.challenge?.(document, url) ?? null;
        } catch (error) {
            warn("challenge threw", error);
            return null;
        }
    }

    // The site's own search box is submitted once per document; the page that follows answers the next ask.
    let submitting = false;
    let submitNote: string | null = null;
    let submitted = false;

    function search(query: string): SearchResponse {
        let results: SearchResult[] | null = null;
        let failure: string | null = null;
        let nextUrl: string | null = null;
        try {
            results = page.searchResults?.(document, location.href) ?? null;
            if (results === null) failure = page.searchFailure?.(document, location.href) ?? null;
            else nextUrl = page.searchNextUrl?.(document, location.href) ?? null;
        } catch (error) {
            warn("searchResults threw", error);
        }
        if (results === null && failure === null && page.submitSearch && !submitting) {
            submitting = true;
            page.submitSearch(document, location.href, query).then(
                (result) => {
                    submitted = result?.submitted ?? false;
                    if (!submitted) submitting = false; // no box yet, or a submit that got nowhere: try again on the next ask
                    submitNote = result?.note ?? "no search box on this page yet";
                },
                (error) => {
                    submitNote = `submitting the search threw: ${String(error)}`;
                    warn("submitSearch threw", error);
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
            submitting: submitting && results === null,
            ...(submitNote ? { submitNote, submitted } : {}),
            ...(failure ? { failure } : {}),
            ...(challenge ? { challenge } : {}),
        };
    }

    // Every answer is synchronous: the askers poll, and a page that is not ready is asked again.
    const onMessage = (raw: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean => {
        if (!isMessage(raw)) return false;
        switch (raw.type) {
            case "status": {
                sendResponse(status());
                return false;
            }
            case "extract": {
                let capture = null;
                try {
                    capture = manualCapture(page, document, location.href);
                } catch (error) {
                    warn("extract threw", error);
                }
                const response: ExtractResponse = { type: "extract-response", source, capture };
                sendResponse(response);
                return false;
            }
            case "search": {
                sendResponse(search(raw.query));
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

    forwardLogTo(location.hostname.replace(/^www\./, ""));
}
