/**
 * "Hyde Park, Austin, TX" -> "hyde-park-austin-tx": the slug most
 * listing sites make of free text in their search URLs. Pure, with no
 * imports, so a descriptor's urls.ts can use it from Node (the manifest
 * generator loads descriptors there).
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
