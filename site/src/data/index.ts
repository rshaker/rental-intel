import { generateAll, TODAY, type SeedListing, type SeedPlan, type SeedUnit } from "./generate.js";
import { NEIGHBORHOODS, type Neighborhood } from "./places.js";
import { SITE_ORIGIN } from "../../../src/sources/example/origin.js";

/** The data of the example site, and the few derivations the pages and the store spec share. */

/** The site's root URL (src/sources/example/origin.ts) and where its photos are, a path under it. */
export const PAGES_ORIGIN = SITE_ORIGIN;
export const PHOTOS_ORIGIN = `${SITE_ORIGIN}/photos`;
/** The search slug that lists the whole city; "Austin, TX" slugifies to it. */
export const ALL_SLUG = "austin-tx";

export const listings: readonly SeedListing[] = generateAll();

export { NEIGHBORHOODS, TODAY };
export type { Neighborhood, SeedListing, SeedPlan, SeedUnit };

/** "Hyde Park" -> "hyde-park"; the same rule as the extension's slugify. */
export function slug(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function listingUrl(id: string): string {
    return `${PAGES_ORIGIN}/l/${id}/`;
}

export function searchUrl(slugText: string): string {
    return `${PAGES_ORIGIN}/search/${slugText}/`;
}

export function photoUrl(id: string, n: number): string {
    return `${PHOTOS_ORIGIN}/${id}/${n}.svg`;
}

/** "2210 Rio Grande St #4" for a home with a unit; a building's street line. */
export function streetLine(l: SeedListing): string {
    return l.unit ? `${l.street} #${l.unit}` : l.street;
}

export function addressText(l: SeedListing): string {
    return `${streetLine(l)}, Austin, TX ${l.zip}`;
}

export function units(l: SeedListing): SeedUnit[] {
    return l.plans.flatMap((p) => p.units);
}

function span(values: number[]): [number, number] {
    return [Math.min(...values), Math.max(...values)];
}

export function rentRange(l: SeedListing): [number, number] {
    return span(units(l).map((u) => u.rent));
}

export function bedsRange(l: SeedListing): [number, number] {
    return span(l.plans.map((p) => p.beds));
}

export function bathsRange(l: SeedListing): [number, number] {
    return span(l.plans.map((p) => p.baths));
}

export function money(n: number): string {
    return `$${n.toLocaleString("en-US")}`;
}

function rangeText(lo: number, hi: number, f: (n: number) => string): string {
    return lo === hi ? f(lo) : `${f(lo)} – ${f(hi)}`;
}

/** "$1,895 – $2,850" or "$2,400". */
export function priceText(l: SeedListing): string {
    const [lo, hi] = rentRange(l);
    return rangeText(lo, hi, money);
}

export function bedsWord(n: number): string {
    return n === 0 ? "Studio" : `${n}bd`;
}

/** "Studio – 2bd · 1 – 2ba" for a building, "2bd/1ba · 1,150 sqft" for a home. */
export function factsText(l: SeedListing): string {
    if (l.kind === "home") {
        const u = units(l)[0]!;
        return `${bedsWord(u.beds)}/${u.baths}ba · ${u.sqft.toLocaleString("en-US")} sqft`;
    }
    const [b0, b1] = bedsRange(l);
    const [a0, a1] = bathsRange(l);
    return `${rangeText(b0, b1, bedsWord)} · ${rangeText(a0, a1, String)}ba`;
}

/** "Nov 1" or "Available now", the way the page prints a unit's date. */
export function availableText(available: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(available)) return available;
    const d = new Date(`${available}T12:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function hasCats(l: SeedListing): boolean {
    return /cats/i.test(l.pets) && !/\bno\b/i.test(l.pets);
}

export function hasLaundryInUnit(l: SeedListing): boolean {
    return l.amenities.some((a) => /in-unit laundry/i.test(a));
}
