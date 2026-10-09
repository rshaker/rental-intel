import { liveQuery } from "dexie";
import { useEffect, useRef, useState } from "preact/hooks";
import { getPhotos } from "../../db/photos";
import { log, LogLevels } from "../../lib/logging";
import { photoIndexOf, photoMode, setPhotoIndex } from "../store";
import { useCarousel } from "./Card";

/**
 * An open card's photos: one large photo with arrows (the carousel), or a
 * row of thumbnails (the strip), by the Images setting. The photos are a
 * live query over the database, so the ones a save is still fetching
 * appear as they land. Object URLs live only while the card is open.
 */

/** Every stored photo of a listing as object URLs, in the extractor's order, while mounted. */
function usePhotoUrls(listingId: string): string[] {
    const [urls, setUrls] = useState<string[]>([]);
    useEffect(() => {
        let current: string[] = [];
        const subscription = liveQuery(() => getPhotos(listingId)).subscribe({
            next: (photos) => {
                for (const url of current) URL.revokeObjectURL(url);
                current = photos.map((photo) => URL.createObjectURL(photo.blob));
                setUrls(current);
            },
            error: (error: unknown) => log(LogLevels.WARN, "photos query failed", error),
        });
        return () => {
            subscription.unsubscribe();
            for (const url of current) URL.revokeObjectURL(url);
        };
    }, [listingId]);
    return urls;
}

export function Photos({ listingId }: { listingId: string }) {
    const urls = usePhotoUrls(listingId);
    const mode = photoMode.value;
    const count = urls.length;
    const index = count ? ((photoIndexOf(listingId) % count) + count) % count : 0;
    const show = (next: number): void => {
        if (count) setPhotoIndex(listingId, ((next % count) + count) % count);
    };
    useCarousel(listingId, count ? (delta) => show(index + delta) : null);

    if (count === 0) return null;
    if (mode === "strip") return <Strip listingId={listingId} urls={urls} index={index} onShow={show} />;
    return (
        <figure class="photo">
            <img src={urls[index]} alt="" />
            {/* Wraps at both ends; the arrows disappear for a single photo. */}
            <div class="carousel-nav" hidden={count <= 1}>
                <button type="button" class="carousel-prev" aria-label="Previous photo" onClick={() => show(index - 1)}>
                    ‹
                </button>
                <span class="carousel-counter">{`${index + 1} / ${count}`}</span>
                <button type="button" class="carousel-next" aria-label="Next photo" onClick={() => show(index + 1)}>
                    ›
                </button>
            </div>
        </figure>
    );
}

/**
 * Thumbnail mode: the same index is the highlighted thumbnail, kept scrolled
 * into view sideways only -- never scrolling the panel itself. A click makes
 * that photo current and shows it full-size in the active tab, as a history
 * entry, so Back returns to the listing. The tab goes to the extension's own
 * viewer page, which reads the photo from the database itself: tabs.update
 * accepts a blob: URL but never navigates to it, and an object URL would die
 * with this card anyway.
 */
function Strip({ listingId, urls, index, onShow }: { listingId: string; urls: string[]; index: number; onShow(index: number): void }) {
    const strip = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const thumb = strip.current?.children[index] as HTMLElement | undefined;
        if (!strip.current || !thumb) return;
        const left = thumb.offsetLeft;
        const right = left + thumb.offsetWidth;
        if (left < strip.current.scrollLeft) strip.current.scrollLeft = left;
        else if (right > strip.current.scrollLeft + strip.current.clientWidth) strip.current.scrollLeft = right - strip.current.clientWidth;
    }, [index]);
    return (
        <div class="strip" aria-label="Photos" ref={strip}>
            {urls.map((url, n) => (
                <button
                    key={url}
                    type="button"
                    class={`thumb${n === index ? " current" : ""}`}
                    aria-label={`Photo ${n + 1}`}
                    onClick={() => {
                        onShow(n);
                        const viewer = chrome.runtime.getURL(`src/viewer/index.html?id=${encodeURIComponent(listingId)}&n=${n}`);
                        void chrome.tabs.update({ url: viewer }).catch(() => undefined);
                    }}
                >
                    <img src={url} alt="" loading="lazy" decoding="async" />
                </button>
            ))}
        </div>
    );
}
