import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { updateUserFields } from "../../db/listings";
import type { Settings } from "../../db/settingsSchema";
import { LISTING_STATUSES, STATUS_LABELS, displayName, type Listing, type ListingStatus } from "../../db/types";
import type { DetailRow, ViewContext } from "../../sources/contract";
import { sourceAbbreviation, sourceLabel } from "../../sources";
import { FEATURES } from "../../sources/shared/filters";
import { viewFor } from "../sourceViews";
import { availabilityText, bedsRange, countRange, facts, formatDate, moneyRange, plural, shortFacts, sizeRange } from "../format";
import type { Relations } from "../query";
import { selected, toggleSelected } from "../selection";
import { isCardOpen, isSectionOpen, setCardOpen, setSectionsOpen } from "../store";
import { Links, Notes, Plans, Units } from "./CardSections";
import { Photos } from "./Photos";
import { CurrentTabLink, ICON, LinkIcons } from "./links";

/**
 * One listing as a card: a one-line summary that expands into photos, the
 * status and a stack of collapsible sections. Everything shown comes from
 * `core`; the site's view appends its own rows and sections. Open state
 * lives in the store, so a repaint never closes anything.
 */

export interface CardProps {
    listing: Listing;
    isActive: boolean;
    settings: Settings;
    relations: Relations;
    onJump(id: string): void;
}

const KIND_LABELS = { home: `${ICON.home} Home`, building: `${ICON.building} Bldg` } as const;

/** Every section a card can have; expand-all opens them all by key, and a key for a section that never appears is inert. */
/** A feature's full name for the Details row: the hover text where the checkbox label is abbreviated. */
const FEATURE_LABELS = new Map(FEATURES.map((field) => [field.key, field.title ?? field.label]));

export const SECTION_NAMES = ["details", "plans", "units", "amenities", "fees", "description", "notes", "links"] as const;

export function Card({ listing, isActive, settings, relations, onJump }: CardProps) {
    const { id, core } = listing;
    const open = isCardOpen(id);
    const isSelected = selected.value.has(id);
    const toggle = (): void => setCardOpen(id, !open);

    return (
        <article class={`card${open ? " open" : ""}${isActive ? " active" : ""}${isSelected ? " selected" : ""}`} data-id={id} data-source={listing.source}>
            {/* A div with button semantics: the title carries a link and a checkbox, which a <button> may not contain. */}
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
                    <CurrentTabLink class={`source-badge source-${listing.source}`} href={listing.url} title={`Open the listing on ${sourceLabel(listing.source)}`} onClick={(event) => event.stopPropagation()}>
                        {sourceAbbreviation(listing.source)}
                    </CurrentTabLink>
                </span>
                <div class="summary-text">
                    <h2>
                        <span class="title">{displayName(listing)}</span>
                    </h2>
                    {/* The full facts line under an open card's title, and a shorter one on the closed row; CSS shows whichever applies. */}
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

    const names: string[] = ["details"];
    if (hasPlans) names.push("plans", "units");
    if (core.amenities.length) names.push("amenities");
    if (core.fees.length || core.pets) names.push("fees");
    if (core.description) names.push("description");
    names.push(...sections.map((section) => section.key), "notes", "links");
    const openAll = (open: boolean): void => setSectionsOpen(names.map((name) => `${id}:${name}`), open);

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
                    <button type="button" class="tool icon fold-all-open" title="Open all sections" aria-label="Open all sections" onClick={() => openAll(true)}>
                        ⊞
                    </button>
                    <button type="button" class="tool icon fold-all-close" title="Close all sections" aria-label="Close all sections" onClick={() => openAll(false)}>
                        ⊟
                    </button>
                </span>
            </div>
            {/* What the site said first, then what is the user's. */}
            <Section id={id} name="details" label="Details">
                <Details listing={listing} settings={settings} relations={relations} onJump={onJump} />
            </Section>
            {hasPlans && (
                <>
                    <Section id={id} name="plans" label="Plans" hint={String(core.plans.length)}>
                        <Plans plans={core.plans} />
                    </Section>
                    <UnitsSection listing={listing} saved={units} onJump={onJump} />
                </>
            )}
            {core.amenities.length > 0 && (
                <Section id={id} name="amenities" label="Amenities" hint={String(core.amenities.length)}>
                    <ul class="amenities field-body">
                        {core.amenities.map((amenity, i) => (
                            <li key={i}>{amenity}</li>
                        ))}
                    </ul>
                </Section>
            )}
            {(core.fees.length > 0 || core.pets) && (
                <Section id={id} name="fees" label="Fees & policies" hint={core.fees.length ? String(core.fees.length) : ""}>
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
                </Section>
            )}
            {core.description && (
                <Section id={id} name="description" label="Description">
                    <p class="description field-body">{core.description}</p>
                </Section>
            )}
            {sections.map((section) => (
                <Section key={section.key} id={id} name={section.key} label={section.label}>
                    <div class="field-body">{section.render()}</div>
                </Section>
            ))}
            <NotesSection listing={listing} />
            <LinksSection listing={listing} />
        </div>
    );
}

/** A section folded behind a +/- toggle, closed by default. `hint` is a short marker shown while folded. */
export function Section({ id, name, label, hint = "", hidden = false, children }: { id: string; name: string; label: string; hint?: string; hidden?: boolean; children: ComponentChildren }) {
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

function UnitsSection({ listing, saved, onJump }: { listing: Listing; saved: readonly Listing[]; onJump(id: string): void }) {
    const count = listing.core.plans.reduce((n, plan) => n + plan.units.length, 0) + saved.filter((home) => !listing.core.plans.some((plan) => plan.units.some((unit) => unit.id === home.sourceId))).length;
    if (count === 0) return null;
    const savedCount = saved.length;
    return (
        <Section id={listing.id} name="units" label="Units" hint={savedCount ? `${savedCount} saved of ${count}` : String(count)}>
            <Units plans={listing.core.plans} saved={saved} onJump={onJump} />
        </Section>
    );
}

function NotesSection({ listing }: { listing: Listing }) {
    const [draft, setDraft] = useState(listing.user.notes);
    return (
        <Section id={listing.id} name="notes" label="Notes" hint={draft.trim() ? "●" : ""}>
            <Notes listingId={listing.id} value={draft} onChange={setDraft} />
        </Section>
    );
}

function LinksSection({ listing }: { listing: Listing }) {
    const [links, setLinks] = useState(listing.user.links);
    return (
        <Section id={listing.id} name="links" label="Links" hint={links.length ? String(links.length) : ""}>
            <Links listingId={listing.id} links={links} onChange={setLinks} />
        </Section>
    );
}

function Row({ label, children }: { label: string; children: ComponentChildren }) {
    return (
        <>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </>
    );
}

/** Details: everything structured we hold, as label/value rows. A row whose value is unknown is left out. */
function Details({ listing, settings, relations, onJump }: Omit<CardProps, "isActive">) {
    const { core } = listing;
    const units = core.plans.reduce((n, plan) => n + plan.units.length, 0);
    const availability = [core.availableUnits === null ? "" : plural(core.availableUnits, "unit"), availabilityText(core.availableFrom)].filter(Boolean).join(", ");
    const contact = [core.contact.company, core.contact.phone].filter(Boolean).join(" · ");
    const rent = moneyRange(core.rent);

    const rows: DetailRow[] = [
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
        ["features", "Features", core.features.length ? core.features.map((key) => FEATURE_LABELS.get(key) ?? key).join(", ") : null],
        ["availability", "Availability", availability || null],
        ["plans", "Plans", core.plans.length ? `${plural(core.plans.length, "plan")}${units ? `, ${plural(units, "unit")}` : ""}` : null],
        ["contact", "Contact", contact || null],
        ["source", "Source", `${sourceLabel(listing.source)} · ${listing.sourceId}`],
        ["readMethod", "Source data", listing.partial ? `${listing.readMethod} — page layout only; reload the page and re-capture for the full record` : listing.readMethod],
        ["photos", "Photos", core.photoUrls.length ? `${core.photoUrls.length} captured` : null],
        ["saved", "Saved", formatDate(listing.createdAt)],
        ["updated", "Updated", formatDate(listing.updatedAt)],
        ["captured", "Captured", formatDate(listing.capturedAt)],
    ];
    // Each core row has a switch in the Details settings; the site's own rows have none.
    const shown = rows.filter(([key]) => (settings as Record<string, unknown>)[`details.${key}`] !== false);
    const ctx: ViewContext = { building: relations.buildingOf.get(listing.id) ?? null, onJump };
    const viewRows = viewFor(listing.source)?.detailRows(listing, ctx) ?? [];

    return (
        <dl class="details field-body">
            {[...shown, ...viewRows].map(([key, label, value]) =>
                value === null || value === "" ? null : (
                    <Row key={key} label={label}>
                        {value}
                    </Row>
                ),
            )}
        </dl>
    );
}

/** The carousel steps the keyboard can reach, one per rendered open card. */
export const carousels = new Map<string, (delta: number) => void>();

export function useCarousel(id: string, step: ((delta: number) => void) | null): void {
    useEffect(() => {
        if (!step) return;
        carousels.set(id, step);
        return () => {
            if (carousels.get(id) === step) carousels.delete(id);
        };
    }, [id, step]);
}
