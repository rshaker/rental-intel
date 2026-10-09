import type { SubmitResult } from "../contract";
import { poll, sleep } from "../../lib/poll";
import { data } from "../shared/dom";
import { clean } from "../shared/values";

/**
 * Submitting apartments.com's own search box. The site resolves free text
 * through its geography service before it builds a URL, so a search starts
 * on the home page: the text goes into the box (a contenteditable div drawn
 * by the site's scripts), the first suggestion under Areas is taken, and
 * the page that follows is the results. Live runs showed text assigned to
 * the box never appearing, so typing goes through `execCommand("insertText")`
 * with the key events a keyboard raises, and is checked and repeated. From
 * the 2026-10-03 capture (playwright/fixtures/apartments-home.html).
 */

const BOX = "#homepage-smart-search .smart-search-input, .smart-search-input";
const ITEMS = ".smart-search-typeahead-dropdown-container li.smart-search-item";
const SEARCH_BUTTON = ".smart-search-btn-search";

/** How long one attempt waits for the site to draw its box before reporting that it is not there yet. */
const BOX_WAIT_MS = 2_000;
/** After typing, how long before checking that the text stayed. */
const TYPE_SETTLE_MS = 300;
const TYPE_ATTEMPTS = 4;
/** How long the site gets to offer a suggestion before Enter is sent on whatever is typed. */
const SUGGESTION_WAIT_MS = 4_000;
const SUGGESTION_POLL_MS = 150;
/** After asking the site to search, how long the page gets to start leaving before the next way of asking. */
const LEAVE_WAIT_MS = 1_500;

/** What was done; null when this page has no box yet. Each way of asking must make the page start leaving: a clicked suggestion that goes nowhere (seen live) is followed by Enter, then the search button. */
export async function submitSiteSearch(doc: Document, query: string): Promise<SubmitResult | null> {
    const started = Date.now();
    const since = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

    const typed = await typeInto(doc, query);
    if (typed === null) return null;
    if (!typed.box) return { submitted: false, note: `could not keep "${query}" in the box: ${typed.note}` };

    const leaving = watchLeaving(doc);
    const steps: string[] = [];
    const left = async (step: string): Promise<boolean> => {
        steps.push(step);
        return (await waitFor(() => (leaving() ? true : null), LEAVE_WAIT_MS)) ?? false;
    };

    const item = await waitFor(() => firstSuggestion(doc), SUGGESTION_WAIT_MS);
    if (item) {
        press(item);
        if (await left(`took the suggestion "${clean(item.textContent)}" at ${since()}`)) return { submitted: true, note: `${typed.note}; ${steps.join(", ")}` };
    } else {
        steps.push(`no suggestion after ${since()}`);
    }
    // Enter takes the first suggestion for a person; the button searches what was typed.
    for (const type of ["keydown", "keypress", "keyup"]) typed.box.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    if (await left("sent Enter")) return { submitted: true, note: `${typed.note}; ${steps.join(", ")}` };
    doc.querySelector<HTMLElement>(SEARCH_BUTTON)?.click();
    if (await left("pressed the button")) return { submitted: true, note: `${typed.note}; ${steps.join(", ")}` };
    return { submitted: false, note: `${typed.note}; ${steps.join(", ")}; the page stayed (${since()})` };
}

/** A click as a pointer makes it: pointer, mouse, then click, on the element itself. */
function press(element: HTMLElement): void {
    const init = { bubbles: true, cancelable: true, button: 0 };
    if (typeof PointerEvent === "function") element.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new MouseEvent("mousedown", init));
    if (typeof PointerEvent === "function") element.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerType: "mouse", isPrimary: true }));
    element.dispatchEvent(new MouseEvent("mouseup", init));
    element.dispatchEvent(new MouseEvent("click", init));
}

/** Whether the document has started leaving: a navigation the site began. */
function watchLeaving(doc: Document): () => boolean {
    let left = false;
    const mark = (): void => {
        left = true;
    };
    const view = doc.defaultView;
    view?.addEventListener("pagehide", mark, { once: true });
    view?.addEventListener("beforeunload", mark, { once: true });
    return () => left;
}

interface Typed {
    /** The box holding the text; null when the text would not stay. */
    box: HTMLElement | null;
    note: string;
}

/** Puts the query in the box and makes sure it stayed there. Null when there is no box at all. */
async function typeInto(doc: Document, query: string): Promise<Typed | null> {
    let problem = "";
    for (let attempt = 1; attempt <= TYPE_ATTEMPTS; attempt++) {
        const box = await waitFor(() => findBox(doc), attempt === 1 ? BOX_WAIT_MS : TYPE_SETTLE_MS);
        if (!box) return attempt === 1 ? null : { box: null, note: `${problem}; then no box at all` };
        const how = putText(doc, box, query);
        await sleep(TYPE_SETTLE_MS);
        const reads = clean(box.textContent) ?? "";
        if (box.isConnected && reads === query) {
            return { box, note: `typed by ${how}${attempt > 1 ? ` on attempt ${attempt}` : ""}; the box reads "${reads}"` };
        }
        problem = box.isConnected ? `after typing by ${how} the site left the box reading "${reads}"` : `after typing by ${how} the site replaced the box`;
    }
    return { box: null, note: `${problem} (${TYPE_ATTEMPTS} attempts)` };
}

/** The box the user sees: one that is on the page and drawn; else whichever exists. */
function findBox(doc: Document): HTMLElement | null {
    const boxes = [...doc.querySelectorAll<HTMLElement>(BOX)].filter((box) => box.isConnected);
    return boxes.find((box) => box.getClientRects().length > 0) ?? boxes[0] ?? null;
}

/** Types the text as a keyboard would, as far as a script can; falls back to writing the text node when the editing pipeline is not there or did not take. */
function putText(doc: Document, box: HTMLElement, query: string): string {
    box.focus();
    try {
        const range = doc.createRange();
        range.selectNodeContents(box);
        const selection = doc.defaultView?.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    } catch {
        // No selection API here. The fallback below needs none.
    }
    for (const type of ["keydown", "keypress"]) box.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: query.slice(-1) }));

    let how = "the editing pipeline";
    let inserted = false;
    try {
        inserted = typeof doc.execCommand === "function" && doc.execCommand("insertText", false, query) && clean(box.textContent) === query;
    } catch {
        inserted = false;
    }
    if (!inserted) {
        how = "writing the text";
        box.textContent = query;
        box.dispatchEvent(new InputEvent("input", { bubbles: true, data: query, inputType: "insertText" }));
    }
    box.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: query.slice(-1) }));
    return how;
}

/** The first suggestion under Areas, else the first that is not a remembered search. */
export function firstSuggestion(doc: Document): HTMLElement | null {
    const items = [...doc.querySelectorAll<HTMLElement>(ITEMS)].filter((item) => data(item, "type") !== "history" && clean(item.textContent));
    const area = items.find((item) => /^areas?$/i.test(clean(item.closest(".smart-search-category-wrapper")?.querySelector(".smart-search-category-title")?.textContent) ?? ""));
    return area ?? items[0] ?? null;
}

/** The site's own "page not found" page, which a bad pasted URL lands on. */
export function searchFailure(doc: Document): string | null {
    const title = clean(doc.title) ?? "";
    const heading = clean(doc.querySelector("h1, h2")?.textContent) ?? "";
    if (/\b404\b|not found/i.test(title) || /get somewhere else/i.test(heading)) return "Apartments.com has no page at that address. Try a city, neighbourhood or zip, or paste a search URL from the site.";
    return null;
}

/** Looks every SUGGESTION_POLL_MS until `look` finds something, or the budget runs out. */
function waitFor<T>(look: () => T | null, budgetMs: number): Promise<T | null> {
    return poll(async () => look(), (found) => found, { every: SUGGESTION_POLL_MS, deadline: Date.now() + budgetMs });
}
