/**
 * Whether a hostname is `domain` or one of its subdomains. Pure, with no
 * imports, so a descriptor's urls.ts can use it from Node (the manifest
 * generator loads descriptors there).
 */
export function hostMatcher(domain: string): (hostname: string) => boolean {
    const suffix = `.${domain}`;
    return (hostname) => hostname === domain || hostname.endsWith(suffix);
}
