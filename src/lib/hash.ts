/**
 * Hex SHA-256 of a blob's bytes -- the photo primary key.
 *
 * This lives outside db/ on purpose. It touches no database, and the content
 * script's debug handle wants it without dragging Dexie into a site's page --
 * see lib/debug.ts for why that split is load-bearing. db/photos.ts re-exports
 * it, so the photo surface still reads as one import at its call sites.
 */
export async function hashBlob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
