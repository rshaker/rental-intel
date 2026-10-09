/**
 * Small DOM helpers for the parts of the panel that build elements by hand:
 * the sources' views, which return DOM for their own rows and sections, and
 * the card's hooks for them.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: { className?: string; text?: string; title?: string } = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (props.className) element.className = props.className;
    if (props.text !== undefined) element.textContent = props.text;
    if (props.title) element.title = props.title;
    element.append(...children);
    return element;
}

export function anchor(href: string, text: string): HTMLAnchorElement {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = text;
    return a;
}

/**
 * A link that opens in the tab beside the panel, the way a thumbnail does,
 * so Back returns to where you were. A plain click is taken over; a click
 * with a modifier, or the middle button, is left to the browser, so
 * ctrl-click and middle-click still open a new tab from the href.
 */
export function currentTabLink(href: string, text: string): HTMLAnchorElement {
    const a = anchor(href, text);
    a.classList.add("go");
    a.removeAttribute("target");
    a.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        void chrome.tabs.update({ url: href }).catch(() => undefined);
    });
    return a;
}

/**
 * The panel's icon vocabulary. A link is an icon and nothing else; what the
 * icon means is fixed here and nowhere else:
 *   🌎 a page on the web (the listing on its site)
 *   🗂️ a card in this panel
 *   🗺️ a map
 *   🏠 🏢 what kind of thing is being talked about
 */
export const ICON = {
    web: "\u{1F30E}",
    card: "\u{1F5C2}️",
    map: "\u{1F5FA}️",
    home: "\u{1F3E0}",
    building: "\u{1F3E2}",
} as const;

export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
