import { useState } from "preact/hooks";
import { updateUserFields } from "../../db/listings";
import { displayName, type Listing, type Plan } from "../../db/types";
import { moneyRange, shortFacts, sizeRange, unitFacts } from "../format";
import { normalizeLink } from "../links";
import { LinkIcons } from "./links";

/** The sections of an open card that are more than a list: plans, units, notes, links. */

export function Plans({ plans }: { plans: readonly Plan[] }) {
    return (
        <table class="plans field-body">
            <thead>
                <tr>
                    <th>Plan</th>
                    <th class="num">Beds</th>
                    <th class="num">Baths</th>
                    <th class="num">Sqft</th>
                    <th class="num">Rent</th>
                    <th class="num">Units</th>
                </tr>
            </thead>
            <tbody>
                {plans.map((plan, i) => (
                    <tr key={plan.id ?? i}>
                        <td>{plan.name ?? "—"}</td>
                        <td class="num">{plan.beds === null ? "—" : plan.beds === 0 ? "Studio" : String(plan.beds)}</td>
                        <td class="num">{plan.baths === null ? "—" : String(plan.baths)}</td>
                        <td class="num">{sizeRange(plan.sqft, "")?.trim() ?? "—"}</td>
                        <td class="num">{moneyRange(plan.rent) ?? "—"}</td>
                        <td class="num">{plan.availableUnits === null ? "—" : String(plan.availableUnits)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** A row of the Units list: one unit, named as the building names it. */
interface UnitRow {
    label: string;
    facts: string;
    url: string | null;
    /** The home listing saved from this unit, when there is one. */
    saved: Listing | null;
    /** False for a unit the site lists but is not renting (off market, for sale); the row is dimmed. */
    offered: boolean;
}

/**
 * The building's units in the site's order, each marked saved when a home
 * listing with its id exists on the same site. Saved homes the building does
 * not list (a unit since taken down) follow, under their own names.
 */
function unitRows(plans: readonly Plan[], saved: readonly Listing[]): UnitRow[] {
    const savedById = new Map(saved.map((home) => [home.sourceId, home]));
    const rows: UnitRow[] = [];
    const listed = new Set<string>();
    for (const plan of plans) {
        for (const unit of plan.units) {
            if (unit.id) listed.add(unit.id);
            const home = unit.id ? (savedById.get(unit.id) ?? null) : null;
            rows.push({
                label: unit.name ?? (plan.name ? `${plan.name} unit` : unit.id ? `Unit ${unit.id}` : "Unit"),
                facts: unitFacts(unit),
                url: home?.url ?? unit.url,
                saved: home,
                offered: unit.status !== "off-market" && unit.status !== "for-sale",
            });
        }
    }
    for (const home of saved) {
        if (listed.has(home.sourceId)) continue;
        rows.push({ label: displayName(home), facts: shortFacts(home.core).filter(Boolean).join(" · "), url: home.url, saved: home, offered: true });
    }
    return rows;
}

/** Every unit with a page reaches it; the saved ones reach their card too. */
export function Units({ plans, saved, onJump }: { plans: readonly Plan[]; saved: readonly Listing[]; onJump(id: string): void }) {
    const rows = unitRows(plans, saved);
    const anyPages = rows.some((row) => row.url !== null);
    return (
        <ul class="units field-body">
            {rows.map((row, i) => (
                <li key={i} class={row.offered ? "" : "unit-off"}>
                    {row.label}
                    {anyPages ? <LinkIcons slots={{ web: row.url, card: row.saved ? { id: row.saved.id, name: displayName(row.saved) } : null }} describe={row.label} onJump={onJump} /> : " "}
                    <span class="unit-facts">{row.facts}</span>
                    {row.saved && <span class="unit-tag">saved</span>}
                </li>
            ))}
        </ul>
    );
}

/** The user's notes. Written on blur rather than per keystroke; good enough for a personal tool. */
export function Notes({ listingId, value, onChange }: { listingId: string; value: string; onChange(value: string): void }) {
    return (
        <textarea
            class="notes field-body"
            aria-label="Notes"
            rows={1} // one line to start; the resize handle is how it grows
            value={value}
            onInput={(event) => onChange(event.currentTarget.value)}
            // The catch covers a blur that lands after this listing was deleted.
            onBlur={() => void updateUserFields(listingId, { notes: value }).catch(() => undefined)}
        />
    );
}

/**
 * The user's own URLs for this place. A list with an × on each, and one
 * field with a + to add the next; Enter adds too. A line that is not a web
 * address is refused and said so, never stored.
 */
export function Links({ listingId, links, onChange }: { listingId: string; links: string[]; onChange(links: string[]): void }) {
    const [text, setText] = useState("");
    const [error, setError] = useState("");

    const save = (next: string[]): void => {
        onChange(next);
        void updateUserFields(listingId, { links: next }).catch(() => undefined);
    };

    return (
        <div class="field-body">
            <ul class="links" hidden={links.length === 0}>
                {links.map((url) => (
                    <li key={url}>
                        <button type="button" class="tool icon link-remove" title={`Remove ${url}`} aria-label={`Remove ${url}`} onClick={() => save(links.filter((link) => link !== url))}>
                            ×
                        </button>
                        <a href={url} target="_blank" rel="noreferrer">
                            {url}
                        </a>
                    </li>
                ))}
            </ul>
            <form
                class="link-add"
                onSubmit={(event) => {
                    event.preventDefault();
                    const url = normalizeLink(text);
                    if (url === null) {
                        setError(text.trim() ? "That is not a web address." : "");
                        return;
                    }
                    if (!links.includes(url)) save([...links, url]);
                    setText("");
                    setError("");
                }}
            >
                <button type="submit" class="tool icon link-add-button" title="Add link" aria-label="Add link">
                    +
                </button>
                <input
                    type="text"
                    inputMode="url"
                    autocomplete="off"
                    spellcheck={false}
                    placeholder="https://…"
                    aria-label="Add a link"
                    aria-invalid={error ? "true" : undefined}
                    value={text}
                    onInput={(event) => {
                        setText(event.currentTarget.value);
                        setError("");
                    }}
                />
            </form>
            <p class="link-error" role="status" hidden={!error}>
                {error}
            </p>
        </div>
    );
}
