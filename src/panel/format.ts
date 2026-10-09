import type { CoreFields, NumRange, Unit, UnitStatus } from "../db/types";

/** Numbers and dates the way the panel writes them. Pure, shared by the cards and the viewer. */

export function money(value: number | null): string {
    return value === null ? "--" : `$${value.toLocaleString()}`;
}

/** "$1,200 – $1,800", "$1,200", or null when nothing is known. */
export function moneyRange(range: NumRange): string | null {
    const { min, max } = range;
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min !== max) return `${money(min)} – ${money(max)}`;
    return money(min ?? max);
}

/** "2", "1 – 3", "Studio", "Studio – 2", or null. */
export function bedsRange(range: NumRange): string | null {
    const label = (n: number) => (n === 0 ? "Studio" : String(n));
    const { min, max } = range;
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min !== max) return `${label(min)} – ${label(max)}`;
    return label((min ?? max)!);
}

/** "1.5", "1 – 2.5", or null. */
export function countRange(range: NumRange): string | null {
    const { min, max } = range;
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min !== max) return `${min} – ${max}`;
    return String(min ?? max);
}

/** "900 sqft", "650 – 1,200 sqft", or null. */
export function sizeRange(range: NumRange, unit = "sqft"): string | null {
    const { min, max } = range;
    if (min === null && max === null) return null;
    if (min !== null && max !== null && min !== max) return `${min.toLocaleString()} – ${max.toLocaleString()} ${unit}`;
    return `${(min ?? max)!.toLocaleString()} ${unit}`;
}

export function measure(value: number | null, unit: string): string | null {
    return value === null ? null : `${value.toLocaleString()} ${unit}`;
}

export function formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "13.0 MB", "412 kB", "96 bytes": a size the way a file dialog shows it. */
export function bytesText(bytes: number): string {
    if (bytes < 1000) return `${bytes} bytes`;
    if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "available now", "from Oct 1, 2026", or the site's own words. */
export function availabilityText(availableFrom: string | null): string {
    if (availableFrom === null) return "";
    if (availableFrom === "now") return "available now";
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(availableFrom);
    if (iso) {
        const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return `from ${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
    }
    return `from ${availableFrom}`;
}

/** "2bd/2ba", "Studio/1ba", "3bd", or "". */
export function rooms(beds: number | null, baths: number | null): string {
    const bd = beds === null ? "" : beds === 0 ? "Studio" : `${beds}bd`;
    const ba = baths === null ? "" : `${baths}ba`;
    return bd && ba ? `${bd}/${ba}` : bd || ba;
}

/** The compact rooms text for a listing: ranges collapse to their extent. */
export function roomsRange(core: CoreFields): string {
    const beds = bedsRange(core.beds);
    const baths = countRange(core.baths);
    const bd = beds === null ? "" : beds === "Studio" ? beds : /^\d+$/.test(beds) ? `${beds}bd` : `${beds} bd`;
    const ba = baths === null ? "" : /^[\d.]+$/.test(baths) ? `${baths}ba` : `${baths} ba`;
    return bd && ba ? `${bd}/${ba}` : bd || ba;
}

/** "off market" or "for sale" for a unit not on the rental market; "" otherwise. */
export function unitStatusText(status: UnitStatus | null): string {
    return status === "off-market" ? "off market" : status === "for-sale" ? "for sale" : "";
}

/** One unit's facts on a line: rent, rooms, size, availability (or why there is none). */
export function unitFacts(unit: Pick<Unit, "rent" | "beds" | "baths" | "sqft" | "availableFrom" | "status">): string {
    return [unit.rent === null ? "" : money(unit.rent), rooms(unit.beds, unit.baths), measure(unit.sqft, "sqft") ?? "", unitStatusText(unit.status) || availabilityText(unit.availableFrom)]
        .filter(Boolean)
        .join(" · ");
}

/** The full facts line under an open card's title. */
export function facts(core: CoreFields): string[] {
    const plans = core.plans.length;
    return [
        moneyRange(core.rent) ?? "--",
        roomsRange(core),
        sizeRange(core.sqft) ?? "",
        plans > 1 || (plans === 1 && core.plans[0]!.units.length > 1) ? plural(plans, "plan") : "",
    ];
}

/** The closed row's version: rent and rooms only, tightly set. */
export function shortFacts(core: CoreFields): string[] {
    return [moneyRange(core.rent) ?? "--", roomsRange(core)];
}
