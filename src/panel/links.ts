/**
 * Reading a link the user typed for a listing. Forgiving about the scheme,
 * strict about everything else: it must parse as an http(s) URL with a host.
 * Returns the normalised address, or null when the text is not one.
 */
export function normalizeLink(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed || /\s/.test(trimmed)) return null;
    // Anything that already names a scheme (http:, mailto:, javascript:) is
    // taken as it is and judged below; only a bare host gets https assumed.
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
