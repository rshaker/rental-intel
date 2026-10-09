/** Whether a hostname is `domain` or one of its subdomains. */
export function hostMatcher(domain: string): (hostname: string) => boolean {
    const suffix = `.${domain}`;
    return (hostname) => hostname === domain || hostname.endsWith(suffix);
}
