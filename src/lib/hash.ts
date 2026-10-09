/** Hex SHA-256 of a blob's bytes: the photo primary key. */
export async function hashBlob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
