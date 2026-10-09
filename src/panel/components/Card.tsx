import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { updateUserFields } from "../../db/listings";
import type { Settings } from "../../db/settingsSchema";
import { LISTING_STATUSES, STATUS_LABELS, displayName, type Listing, type ListingStatus } from "../../db/types";
import type { DetailRow, ViewContext } from "../../sources/contract";
import { sourceCode, sourceLabel } from "../../sources";
import { viewFor } from "../../sources/views";
import { ICON, currentTabLink, el } from "../dom";
import { availabilityText, bedsRange, countRange, facts, formatDate, moneyRange, plural, shortFacts, sizeRange } from "../format";
import type { Relations } from "../query";
import { selected, toggleSelected } from "../selection";
import { isCardOpen, isSectionOpen, setCardOpen, setSectionsOpen } from "../store";
import { Links, Notes, Plans, Units } from "./CardSections";
import { Photos } from "./Photos";
import { CurrentTabLink, DomNode, LinkIcons } from "./links";

/**
 * One listing as a card: a one-line summary that expands into photos, the
 * status, and a stack of folded sections -- what the site said (Details,
 * Plans, Units, Amenities, Fees, Description, and whatever the site's own
 * view adds) and then what the user wrote (Notes, Links).
 *
 * Everything shown comes from `core`, so a card looks the same whatever
 * site the listing is from; the site's `view` appends its own rows and
 * sections. Whether the card and each section are open lives in the store,
 * so a repaint never closes anything.
 */

export interface CardProps {
    listing: Listing;
    isActive: boolean;
    settings: Settings;
    relations: Relations;
    /** Brings another card into view, open. */
    onJump(id: string): void;
}

/** Short enough that the two read the same width, so the titles beside them line up. */
const KIND_LABELS = { home: `${ICON.home} Home`, building: `${ICON.building} Bldg` } as const;

/**
 * Every section a card can fold. Expand-all opens them all by key, ahead of
 * the card knowing which it has: a home has no plans and a bare capture has
 * no description, but a key for a fold that never appears is inert.
 */
export const SECTION_NAMES = ["details", "plans", "units", "amenities", "fees", "description", "notes", "links"] as const;

export function Card({ listing, isActive, settings, relations, onJump }: CardProps) {
    const { id, core } = listing;
    const open = isCardOpen(id);
    const isSelected = selected.value.has(id);

    const toggle = (): void => setCardOpen(id, !open);

    return (
        <article class={`card${open ? " open" : ""}${isActive ? " active" : ""}${isSelected ? " selected" : ""}`} data-id={id} data-source={listing.source}>
            {/* Header: always visible, and the whole thing is the expand toggle. A div
                rather than a <button> so the title can carry the listing link and the
                checkbox: interactive content inside a <button> is not valid HTML. Enter
                and Space are wired below to keep it a button to the keyboard. */}
            <div
                class="summary"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={toggle}
                onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle();
                    }
                }}
            >
                {/* The checkbox selects and never expands. */}
                <input
                    type="checkbox"
                    class="check"
                    aria-label="Select"
                    checked={isSelected}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleSelected(id, event.shiftKey);
                    }}
                />
                <span class="badges">
                    <span class={`kind kind-${listing.kind}`}>{KIND_LABELS[listing.kind]}</span>
                    {/* The site tag is the link to the listing's page. Inside the toggle, so its click must not also expand the card. */}
                    <CurrentTabLink class={`source-badge source-${listing.source}`} href={listing.url} title={`Open the listing on ${sourceLabel(listing.source)}`} onClick={(event) => event.stopPropagation()}>
                        {sourceCode(listing.source)}
                    </CurrentTabLink>
                </span>
                <div class="summary-text">
                    <h2>
                        <span class="title">{displayName(listing)}</span>
                    </h2>
                    {/* Two renderings of the facts: the full line under the title of an open
                        card, and a shorter one that shares the closed card's single row with
                        the title. CSS shows whichever applies. */}
                    <div class="facts">{facts(core).filter(Boolean).join("  ·  ")}</div>
                    <div class="facts facts-short">{shortFacts(core).filter(Boolean).join(" · ")}</div>
                </div>
            </div>
            {open && <CardBody listing={listing} settings={settings} relations={relations} onJump={onJump} />}
        </article>
    );
}

function CardBody({ listing, settings, relations, onJump }: Omit<CardProps, "isActive">) {
    const { id, core } = listing;
    const view = viewFor(listing.source);
    const siblings = relations.siblings.get(id) ?? [];
    const units = relations.unitsOf.get(id) ?? [];
    const hasPlans = core.plans.length > 0 && (core.plans.length > 1 || core.plans[0]!.units.length > 1 || listing.kind === "building");
    const sections = useMemo(() => view?.sections?.(listing) ?? [], [view, listing]);

    const folds: string[] = ["details"];
    if (hasPlans) folds.push("plans", "units");
    if (core.amenities.length) folds.push("amenities");
    if (core.fees.length || core.pets) folds.push("fees");
    if (core.description) folds.push("description");
    folds.push(...sections.map((section) => section.key), "notes", "links");
    const foldAll = (open: boolean): void => setSectionsOpen(folds.map((name) => `${id}:${name}`), open);

    return (
        <div class="body">
            <Photos listingId={id} />
            {siblings.length > 0 && (
                <p class="brief">
                    {siblings.map((other, i) => (
                        <span key={other.id}>
                            {i > 0 && " · "}
                            <span class="also">
                                Also on {sourceLabel(other.source)} <LinkIcons slots={{ web: other.url, card: { id: other.id, name: displayName(other) } }} describe={`this listing on ${sourceLabel(other.source)}`} onJump={onJump} />
                            </span>
                        </span>
                    ))}
                </p>
            )}
            {/* Status on its own row, with the card's open-all / close-all at its right. */}
            <div class="status-row">
                <span>Status</span>
                <select class="status-select" aria-label="Status" value={listing.user.status} onChange={(event) => void updateUserFields(id, { status: event.currentTarget.value as ListingStatus }).catch(() => undefined)}>
                    {LISTING_STATUSES.map((status) => (
                        <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                        </option>
                    ))}
                </select>
                <span class="fold-all push">
                    <button type="button" class="tool icon fold-all-open" title="Open all sections" aria-label="Open all sections" onClick={() => foldAll(true)}>
                        ⊞
                    </button>
                    <button type="button" class="tool icon fold-all-close" title="Close all sections" aria-label="Close all sections" onClick={() => foldAll(false)}>
                        ⊟
                    </button>
                </span>
            </div>
            {/* Section order: what the site said first, then what is yours, at the foot. */}
            <Fold id={id} name="details" label="Details">
                <Details listing={listing} settings={settings} relations={relations} onJump={onJump} />
            </Fold>
            {hasPlans && (
                <>
                    <Fold id={id} name="plans" label="Plans" hint={String(core.plans.length)}>
                        <Plans plans={core.plans} />
                    </Fold>
                    <UnitsFold listing={listing} saved={units} onJump={onJump} />
                </>
            )}
            {core.amenities.length > 0 && (
                <Fold id={id} name="amenities" label="Amenities" hint={String(core.amenities.length)}>
                    <ul class="amenities field-body">
                        {core.amenities.map((amenity, i) => (
                            <li key={i}>{amenity}</li>
                        ))}
                    </ul>
                </Fold>
            )}
            {(core.fees.length > 0 || core.pets) && (
                <Fold id={id} name="fees" label="Fees & policies" hint={core.fees.length ? String(core.fees.length) : ""}>
                    <div class="fees field-body">
                        {core.pets && <p class="pets">Pets: {core.pets}</p>}
                        {core.fees.length > 0 && (
                            <dl class="details">
                                {core.fees.map((fee, i) => (
                                    <Row key={i} label={fee.label}>
                                        {fee.text}
                                    </Row>
                                ))}
                            </dl>
                        )}
                    </div>
                </Fold>
            )}
            {core.description && (
                <Fold id={id} name="description" label="Description">
                    <p class="description field-body">{core.description}</p>
                </Fold>
            )}
            {/* What only this listing's site knows how to show. Built on first open. */}
            {sections.map((section) => (
                <Fold key={section.key} id={id} name={section.key} label={section.label}>
                    <ViewSection render={section.render} />
                </Fold>
            ))}
            <NotesFold listing={listing} />
            <LinksFold listing={listing} />
        </div>
    );
}

/** A site view's section, built once when first shown. */
function ViewSection({ render }: { render(): HTMLElement }) {
    const node = useMemo(render, [render]);
    return (
        <div class="field-body">
            <DomNode node={node} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Folds
// ---------------------------------------------------------------------------

/**
 * A section folded behind a +/- toggle, closed by default. `hint` is a short
 * marker shown beside the label while folded, so a card with notes can be
 * told from one without. The body sits in a surface of its own under the
 * title, so the +/- line reads as a label and what follows as its contents.
 */
export function Fold({ id, name, label, hint = "", hidden = false, children }: { id: string; name: string; label: string; hint?: string; hidden?: boolean; children: ComponentChildren }) {
    const key = `${id}:${name}`;
    const open = isSectionOpen(key);
    return (
        <div class="fold">
            <button type="button" class="field-toggle" aria-expanded={open} hidden={hidden} onClick={() => setSectionsOpen([key], !open)}>
                <span class="toggle-glyph" aria-hidden="true">
                    {open ? "−" : "+"}
                </span>
                <span>{label}</span>
                <span class="toggle-hint">{hint}</span>
            </button>
            {open && <div class="fold-body">{children}</div>}
        </div>
    );
}

function UnitsFold({ listing, saved, onJump }: { listing: Listing; saved: readonly Listing[]; onJump(id: string): void }) {
    const count = listing.core.plans.reduce((n, plan) => n + plan.units.length, 0) + saved.filter((home) => !listing.core.plans.some((plan) => plan.units.some((unit) => unit.id === home.sourceId))).length;
    if (count === 0) return null;
    const savedCount = saved.length;
    return (
        <Fold id={listing.id} name="units" label="Units" hint={savedCount ? `${savedCount} saved of ${count}` : String(count)}>
            <Units plans={listing.core.plans} saved={saved} onJump={onJump} />
        </Fold>
    );
}

function NotesFold({ listing }: { listing: Listing }) {
    const [draft, setDraft] = useState(listing.user.notes);
    return (
        <Fold id={listing.id} name="notes" label="Notes" hint={draft.trim() ? "●" : ""}>
            <Notes listingId={listing.id} value={draft} onChange={setDraft} />
        </Fold>
    );
}

function LinksFold({ listing }: { listing: Listing }) {
    const [links, setLinks] = useState(listing.user.links);
    return (
        <Fold id={listing.id} name="links" label="Links" hint={links.length ? String(links.length) : ""}>
            <Links listingId={listing.id} links={links} onChange={setLinks} />
        </Fold>
    );
}

// ---------------------------------------------------------------------------
// Details: everything structured we hold, as label/value rows. A row whose
// value is unknown is left out rather than shown as "--".
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: ComponentChildren }) {
    return (
        <>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </>
    );
}

function Details({ listing, settings, relations, onJump }: Omit<CardProps, "isActive">) {
    const { core } = listing;
    const units = core.plans.reduce((n, plan) => n + plan.units.length, 0);
    const availability = [core.availableUnits === null ? "" : plural(core.availableUnits, "unit"), availabilityText(core.availableFrom)].filter(Boolean).join(", ");
    const contact = [core.contact.company, core.contact.phone].filter(Boolean).join(" · ");
    const rent = moneyRange(core.rent);

    const rows: [key: string, label: string, value: ComponentChildren][] = [
        [
            "address",
            "Address",
            core.address.text ? (
                <span>
                    {core.address.text} <LinkIcons slots={{ map: core.geo ? `https://www.google.com/maps?q=${core.geo.lat},${core.geo.lng}` : null }} describe={displayName(listing)} onJump={onJump} />
                </span>
            ) : null,
        ],
        ["location", "Location", core.geo ? `${core.geo.lat.toFixed(5)}, ${core.geo.lng.toFixed(5)}` : null],
        ["rent", "Rent", rent === null ? null : `${rent} / mo`],
        ["bedrooms", "Bedrooms", bedsRange(core.beds)],
        ["bathrooms", "Bathrooms", countRange(core.baths)],
        ["size", "Size", sizeRange(core.sqft)],
        ["type", "Type", core.propertyType],
        ["availability", "Availability", availability || null],
        ["plans", "Plans", core.plans.length ? `${plural(core.plans.length, "plan")}${units ? `, ${plural(units, "unit")}` : ""}` : null],
        ["contact", "Contact", contact || null],
        ["source", "Source", `${sourceLabel(listing.source)} · ${listing.sourceId}`],
        ["via", "Read from", listing.partial ? `${listing.via} — page layout only; reload the page and re-capture for the full record` : listing.via],
        ["photos", "Photos", core.photoUrls.length ? `${core.photoUrls.length} captured` : null],
        ["saved", "Saved", formatDate(listing.createdAt)],
        ["updated", "Updated", formatDate(listing.updatedAt)],
        ["captured", "Captured", formatDate(listing.capturedAt)],
    ];
    // Each core row has a switch in the Details settings; a switch that is
    // off drops the row. The site's own rows have no switch and stay shown.
    const shown = rows.filter(([key]) => (settings as Record<string, unknown>)[`details.${key}`] !== false);

    // The site's view builds DOM: it is handed element-making helpers.
    const viewCtx: ViewContext = {
        building: relations.buildingOf.get(listing.id) ?? null,
        cardLink: (target) => {
            const button = el("button", { className: "jump icon", text: ICON.card, title: `Show the card for ${displayName(target)}` });
            button.type = "button";
            button.dataset["preview"] = `Card: ${displayName(target)}`;
            button.setAttribute("aria-label", button.title);
            button.addEventListener("click", () => onJump(target.id));
            return button;
        },
        webLink: (href, describe) => {
            const a = currentTabLink(href, ICON.web);
            a.classList.add("icon");
            a.title = `Open ${describe} on the web`;
            a.setAttribute("aria-label", a.title);
            return a;
        },
    };
    const viewRows: DetailRow[] = viewFor(listing.source)?.detailRows(listing, viewCtx) ?? [];

    return (
        <dl class="details field-body">
            {shown.map(([key, label, value]) => (value === null || value === "" ? null : <Row key={key} label={label}>{value}</Row>))}
            {viewRows.map(([key, label, value]) => (value === null || value === "" ? null : <Row key={key} label={label}>{typeof value === "string" ? value : <DomNode node={value} />}</Row>))}
        </dl>
    );
}

/** The carousel steps the keyboard can reach, one per rendered open card. */
export const carousels = new Map<string, (delta: number) => void>();

/** Lets a card register its carousel's stepping function while it is open. */
export function useCarousel(id: string, step: ((delta: number) => void) | null): void {
    useEffect(() => {
        if (!step) return;
        carousels.set(id, step);
        return () => {
            if (carousels.get(id) === step) carousels.delete(id);
        };
    }, [id, step]);
}
