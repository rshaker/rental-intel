/**
 * Coercions for reading site payloads, which arrive as `unknown` and lie
 * about their types: numbers as strings, ids as numbers, "$2,450" as a price.
 * Shared by every source's extractor.
 */

export function num(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const cleaned = value.replace(/[^0-9.-]/g, "");
        if (!/\d/.test(cleaned)) return null;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

/** A non-empty, trimmed string, else null. */
export function str(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/** Ids arrive as numbers on some nodes and strings on others. */
export function idString(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return str(value);
}

export function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

/** Strings from a list of strings, or of objects with a `url`/`name`-like key. */
export function strings(value: unknown, key?: string): string[] {
    const out: string[] = [];
    for (const item of list(value)) {
        const text = str(item) ?? (key ? str(record(item)?.[key]) : null);
        if (text) out.push(text);
    }
    return out;
}

/** "$1,200 - $1,800", "1200-1800", "$1,200+" and "$1,200" as a range. */
export function rangeText(value: unknown): { min: number | null; max: number | null } {
    const text = str(value);
    if (!text) return { min: null, max: null };
    const numbers = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, "")));
    if (numbers.length === 0) return { min: null, max: null };
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    return { min, max: /\+\s*$/.test(text) ? null : max };
}

/** Whitespace collapsed, trimmed. */
export function clean(text: string | null | undefined): string | null {
    const collapsed = text?.replace(/\s+/g, " ").trim();
    return collapsed ? collapsed : null;
}

/**
 * "Available now", "Now", "Available Oct 1", "10/01/2026" and an ISO date as
 * either "now" or an ISO date (YYYY-MM-DD). Anything else is kept as written,
 * so the panel can still show it; the caller decides whether that is fine.
 */
export function availability(value: unknown): string | null {
    const text = clean(str(value));
    if (!text) return null;
    if (/\b(now|today|immediately)\b/i.test(text)) return "now";
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
    const parsed = new Date(text.replace(/^available\s+/i, ""));
    if (!Number.isNaN(parsed.getTime())) {
        // Local date parts: Date.parse reads "Oct 1, 2026" as local midnight,
        // and toISOString would shift it a day east of Greenwich.
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }
    return text;
}

/** "now" beats any date; otherwise the earliest date. Unparsed text is ignored. */
export function soonest(values: readonly (string | null)[]): string | null {
    let best: string | null = null;
    for (const value of values) {
        if (value === null) continue;
        if (value === "now") return "now";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
        if (best === null || value < best) best = value;
    }
    return best;
}
