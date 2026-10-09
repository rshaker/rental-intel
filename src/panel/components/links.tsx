import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { ICON } from "../dom";

/**
 * Links, as the panel draws them. A link is an icon and nothing else; what
 * the icon means is fixed in dom.ts: 🌎 a page on the web, 🗂️ a card in this
 * panel, 🗺️ a map.
 */

/**
 * A link that opens in the tab beside the panel, the way a thumbnail does,
 * so Back returns to where you were. A plain click is taken over; a click
 * with a modifier, or the middle button, is left to the browser, so
 * ctrl-click and middle-click still open a new tab from the href.
 */
export function CurrentTabLink({ href, title, class: className, children, onClick }: { href: string; title?: string; class?: string; children: ComponentChildren; onClick?: (event: MouseEvent) => void }) {
    return (
        <a
            class={className ? `go ${className}` : "go"}
            href={href}
            title={title}
            aria-label={title}
            rel="noreferrer"
            onClick={(event) => {
                onClick?.(event);
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                void chrome.tabs.update({ url: href }).catch(() => undefined);
            }}
        >
            {children}
        </a>
    );
}

/** A link-styled button that brings another card into view, open. `target` names it for the preview bar. */
export function JumpLink({ id, text, target, title, onJump, class: className }: { id: string; text: string; target: string; title?: string; onJump(id: string): void; class?: string }) {
    return (
        <button type="button" class={className ? `jump ${className}` : "jump"} title={title} aria-label={title} data-preview={`Card: ${target}`} onClick={() => onJump(id)}>
            {text}
        </button>
    );
}

export interface LinkSlots {
    web?: string | null;
    card?: { id: string; name: string } | null;
    map?: string | null;
}

/**
 * Where a thing can be reached: its page on the web, its card in the panel,
 * its place on a map. Each slot that is asked for gets an icon; a slot with
 * nowhere to go is drawn greyed rather than left out, so the row keeps its
 * shape and the absence is itself information ("no card for this yet").
 */
export function LinkIcons({ slots, describe, onJump }: { slots: LinkSlots; describe: string; onJump(id: string): void }) {
    const off = (icon: string, why: string) => (
        <span class="icon off" title={why} aria-label={why}>
            {icon}
        </span>
    );
    return (
        <span class="link-icons">
            {"web" in slots && (slots.web ? <CurrentTabLink class="icon" href={slots.web} title={`Open ${describe} on the web`}>{ICON.web}</CurrentTabLink> : off(ICON.web, `No web page for ${describe}`))}
            {"card" in slots && (slots.card ? <JumpLink class="icon" id={slots.card.id} text={ICON.card} target={slots.card.name} title={`Show the card for ${describe}`} onJump={onJump} /> : off(ICON.card, `No card saved for ${describe}`))}
            {"map" in slots && (slots.map ? <CurrentTabLink class="icon" href={slots.map} title={`Show ${describe} on a map`}>{ICON.map}</CurrentTabLink> : off(ICON.map, `No location for ${describe}`))}
        </span>
    );
}

/** A DOM node a source's view built, placed in the tree as it is. */
export function DomNode({ node }: { node: Node }) {
    const holder = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        holder.current?.replaceChildren(node);
    }, [node]);
    return <span ref={holder} />;
}
