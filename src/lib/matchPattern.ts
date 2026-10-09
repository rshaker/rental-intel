/** Chrome match patterns (`*://*.example.com/*`) as predicates over URLs, read the way Chrome reads them. */

const cache = new Map<string, RegExp | null>();

function escape(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The regular expression a pattern stands for, or null when the pattern is malformed. */
export function patternToRegExp(pattern: string): RegExp | null {
    const cached = cache.get(pattern);
    if (cached !== undefined) return cached;

    let result: RegExp | null = null;
    if (pattern === "<all_urls>") {
        result = /^(https?|file|ftp|ws|wss):\/\//;
    } else {
        const match = /^(\*|https?|file|ftp|ws|wss):\/\/([^/]*)(\/.*)$/.exec(pattern);
        if (match) {
            const [, scheme, host, path] = match as unknown as [string, string, string, string];
            const schemeRe = scheme === "*" ? "https?" : escape(scheme);
            let hostRe: string;
            if (host === "*") hostRe = "[^/]+";
            else if (host.startsWith("*.")) hostRe = `(?:[^/]+\\.)?${escape(host.slice(2))}`;
            else hostRe = escape(host);
            const pathRe = path.split("*").map(escape).join(".*");
            result = new RegExp(`^${schemeRe}://${hostRe}(?::\\d+)?${pathRe}$`, "i");
        }
    }
    cache.set(pattern, result);
    return result;
}

export function matchesPattern(pattern: string, url: string): boolean {
    return patternToRegExp(pattern)?.test(url) ?? false;
}

export function matchesAny(patterns: readonly string[], url: string): boolean {
    return patterns.some((pattern) => matchesPattern(pattern, url));
}
