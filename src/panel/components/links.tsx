import type { ComponentChildren } from "preact";

/** Links as the panel draws them: a link is an icon, and what each icon means is fixed here. */
export const ICON = {
    /** A page on the web. */
    web: "\u{1F30E}",
    /** A card in this panel. */
    card: "\u{1F5C2}️",
    map: "\u{1F5FA}️",
    home: "\u{1F3E0}",
    building: "\u{1F3E2}",
} as const;

/** A link that opens in the active tab, so Back returns. A click with a modifier or the middle button is left to the browser. */
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

/** Where a thing can be reached: its page, its card, its place on a map. A slot with nowhere to go is drawn greyed, so the row keeps its shape. */
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
