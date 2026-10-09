import type { Address, CoreFields, GeoPoint } from "../db/types";

/**
 * Whether two listings describe the same place. Pure, so it can be pinned in
 * a unit test; the panel runs it over every pair at render time to draw the
 * "also on …" links, and a later version will run it at capture time to
 * attach a listing to a property.
 *
 * Two listings match when their street addresses agree, or when they sit
 * within a few tens of metres of each other and neither address contradicts
 * the other. A building and one of its units share an address, so a unit
 * designation must agree too when both sides give one.
 */

/** ~30 m: the same building, not the one next door. */
const NEARBY_METRES = 30;

const STREET_WORDS: Record<string, string> = {
    street: "st",
    avenue: "ave",
    av: "ave",
    boulevard: "blvd",
    road: "rd",
    drive: "dr",
    lane: "ln",
    court: "ct",
    place: "pl",
    terrace: "ter",
    parkway: "pkwy",
    highway: "hwy",
    north: "n",
    south: "s",
    east: "e",
    west: "w",
    northeast: "ne",
    northwest: "nw",
    southeast: "se",
    southwest: "sw",
};

/** Lowercase, punctuation dropped, common street words abbreviated. "118 Pecan Street N." -> "118 pecan st n". */
export function normalizeStreet(text: string | null): string | null {
    if (!text) return null;
    const words = text
        .toLowerCase()
        .replace(/[.,#]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => STREET_WORDS[word] ?? word);
    return words.length ? words.join(" ") : null;
}

/** "Unit B", "#204", "Apt 3" -> "b", "204", "3". */
export function normalizeUnit(text: string | null): string | null {
    if (!text) return null;
    const cleaned = text
        .toLowerCase()
        .replace(/\b(unit|apt|apartment|suite|ste|no)\b/g, " ")
        .replace(/[#.,]/g, " ")
        .trim();
    return cleaned || null;
}

/**
 * A key two listings at the same street address share: street line plus zip
 * (or city when the zip is missing). Null when the address has no street
 * line -- a name alone is not an address.
 */
export function addressKey(address: Address): string | null {
    const street = normalizeStreet(address.line1 ?? streetLineOf(address.text));
    if (!street) return null;
    const area = address.zip ?? address.city?.toLowerCase() ?? "";
    return `${street}|${area}`;
}

/**
 * The part of a free-text address before the first comma, when it looks like
 * a street line: it starts with a number. "The Juniper, Springfield" is a name,
 * not a street, and must not become a key.
 */
function streetLineOf(text: string | null): string | null {
    const first = text?.split(",")[0]?.trim() || null;
    return first && /^\d/.test(first) ? first : null;
}

/** Great-circle distance in metres. */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function sameSubject(a: Pick<CoreFields, "address" | "geo">, b: Pick<CoreFields, "address" | "geo">): boolean {
    const unitA = normalizeUnit(a.address.unit);
    const unitB = normalizeUnit(b.address.unit);
    if (unitA && unitB && unitA !== unitB) return false;

    const keyA = addressKey(a.address);
    const keyB = addressKey(b.address);
    if (keyA && keyB) return keyA === keyB;

    if (a.geo && b.geo) return distanceMetres(a.geo, b.geo) <= NEARBY_METRES;
    return false;
}
