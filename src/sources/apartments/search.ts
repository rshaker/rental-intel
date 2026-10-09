import type { DriveResult } from "../contract";
import { data } from "../shared/dom";
import { clean } from "../shared/values";

/**
 * Driving apartments.com's own search box, because the site resolves free
 * text ("78701", "Hyde Park") through its geography service before it
 * builds a URL, and nothing in the text alone says what that URL will be
 * (/austin-tx-78701/ for the zip). So a search starts on the home page:
 * the text goes into the box, the site offers its suggestions, and the
 * first one under Areas is taken, which is what Enter does for a person.
 *
 * From the capture of 2026-10-03 (playwright/fixtures/apartments-home.html):
 * the box is a contenteditable div, the suggestions are li.smart-search-item
 * rows grouped under a .smart-search-category-title ("Areas", "Properties &
 * Management Companies", and "Recent Searches" before anything is typed).
 *
 * The box is drawn and owned by the site's scripts (homepage.bundle.js,
 * which cannot be read from outside the site). Live runs showed text
 * assigned to it never appearing, so the typing here goes through the
 * editing pipeline (`execCommand("insertText")`, which raises the same
 * beforeinput/input events a keyboard does), sends the key events a
 * keyboard would, and then checks that the text is still in a box that is
 * still on the page; when the site has emptied or replaced it, it types
 * again. Every step is reported, for the activity log. The suggestions
 * only draw in a tab that is looked at, which is one reason the panel
 * runs a search in the tab beside it (panel/search/runSearch.ts).
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

/**
 * Resolves to what was done; null when this page has no box yet.
 *
 * Each way of asking the site is checked: the page must start leaving
 * (pagehide / beforeunload) before the ask counts. A live run saw the
 * suggestion clicked at 0.8s and the page stay put -- the site had drawn
 * the row but not yet wired it -- so a click that goes nowhere is followed
 * by Enter, then by the search button, and a drive where none of them
 * moved the page reports so and is run again on the next ask.
 */
export async function driveSearch(doc: Document, query: string): Promise<DriveResult | null> {
    const started = Date.now();
    const since = (): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

    const typed = await typeInto(doc, query);
    if (typed === null) return null;
    if (!typed.box) return { asked: false, note: `could not keep "${query}" in the box: ${typed.note}` };

    const leaving = watchLeaving(doc);
    const steps: string[] = [];
    const left = async (step: string): Promise<boolean> => {
        steps.push(step);
        return (await waitFor(() => (leaving() ? true : null), LEAVE_WAIT_MS)) ?? false;
    };

    const item = await waitFor(() => firstSuggestion(doc), SUGGESTION_WAIT_MS);
    if (item) {
        press(item);
        if (await left(`took the suggestion "${clean(item.textContent)}" at ${since()}`)) return { asked: true, note: `${typed.note}; ${steps.join(", ")}` };
    } else {
        steps.push(`no suggestion after ${since()}`);
    }
    // Enter takes the first suggestion for a person; the button searches what was typed.
    for (const type of ["keydown", "keypress", "keyup"]) typed.box.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13 }));
    if (await left("sent Enter")) return { asked: true, note: `${typed.note}; ${steps.join(", ")}` };
    doc.querySelector<HTMLElement>(SEARCH_BUTTON)?.click();
    if (await left("pressed the button")) return { asked: true, note: `${typed.note}; ${steps.join(", ")}` };
    return { asked: false, note: `${typed.note}; ${steps.join(", ")}; the page stayed (${since()})` };
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

/**
 * Types the text as a keyboard would, as far as a script can: focus, select
 * what is there, insert through the editing pipeline, and send the key
 * events around it. Falls back to writing the text node when the pipeline
 * is not there (a test DOM) or did not take.
 */
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Looks every SUGGESTION_POLL_MS until `probe` finds something, or the budget runs out. */
async function waitFor<T>(probe: () => T | null, budgetMs: number): Promise<T | null> {
    const budget = AbortSignal.timeout(budgetMs);
    for (;;) {
        const found = probe();
        if (found !== null) return found;
        if (budget.aborted) return null;
        await sleep(SUGGESTION_POLL_MS);
    }
}
