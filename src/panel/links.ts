/** A link the user typed, normalised; null unless it parses as an http(s) URL with a host. A bare host gets https. */
export function normalizeLink(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
        const url = new URL(withScheme);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
        return url.href;
    } catch {
        return null;
    }
}
