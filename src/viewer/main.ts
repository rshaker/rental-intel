import { getListing } from "../db/listings";
import { getPhotos } from "../db/photos";
import { displayName } from "../db/types";

/** Full-size photo page, `index.html?id=<listingId>&n=<photo index>`, opened in the active tab from a thumbnail so Back returns to the listing. Reads the blob from the database itself. */

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
