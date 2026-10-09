import { getListing } from "../db/listings";
import { getPhotos } from "../db/photos";
import { displayName } from "../db/types";

/**
 * Full-size photo page: `index.html?id=<listingId>&n=<photo index>`. The side
 * panel navigates the active tab here when a thumbnail is clicked, so the
 * photo is a history entry and Back returns to the listing.
 *
 * It reads the blob from the database itself rather than being handed an
 * object URL: this page runs in the extension origin, so it sees the same
 * IndexedDB as the panel and the worker, and its URL stays valid for Back,
 * Forward, reload and bookmarks -- an object URL minted by the panel would
 * die with the card that made it.
 */

const img = document.querySelector<HTMLImageElement>("#photo")!;
const status = document.querySelector<HTMLElement>("#status")!;

function fail(message: string): void {
    status.textContent = message;
    status.hidden = false;
}

async function main(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const n = Number(params.get("n") ?? "0");
    if (!id || !Number.isInteger(n) || n < 0) return fail("No photo given.");

    const [listing, photos] = await Promise.all([getListing(id), getPhotos(id)]);
    const photo = photos[n];
    if (!listing || !photo) return fail("That photo is no longer stored.");

    document.title = `${displayName(listing)} · ${n + 1} / ${photos.length}`;
    img.src = URL.createObjectURL(photo.blob);
    img.hidden = false;
    status.hidden = true;
}

void main().catch((error: unknown) => fail(String(error)));
