import "./DataPane.css";
import { signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { clearAll, exportBackup, importBackup } from "../../db/backup";
import { backupFilename, parseBackup, serializeBackup, type Backup } from "../../db/backupFormat";
import { activity, type LogKind } from "../activityLog";
import { errorText } from "../dom";
import { bytesText, plural } from "../format";
import { liveListings, livePhotoCount } from "../live";
import { saveTextAs } from "../saveFile";
import { readStored, store } from "../store";

/**
 * The Data tab: back up, restore, Load URLs, Clear all, and the activity
 * log. Every write here changes the database under every open card, so
 * each path ends by telling the host (`onChanged`), which forgets per-card
 * state, tells the other contexts and redraws.
 *
 * The one-line status under the buttons is also written to the activity
 * log, so a result is both seen at once and kept.
 */

const INCLUDE_PHOTOS_KEY = "intel.panel.exportPhotos";

/** The status line, shared with the Load URLs dialog, which writes its summary here without logging it again. */
export const dataStatus = signal("");

export interface DataPaneProps {
    /** Opens the Load URLs dialog. */
    onLoadUrls(): void;
    /** The database was replaced or emptied. */
    onChanged(): Promise<void>;
}

export function DataPane({ onLoadUrls, onChanged }: DataPaneProps) {
    const includePhotos = useSignal(readStored(INCLUDE_PHOTOS_KEY) !== "no");
    /** A parsed backup waiting for the user to say yes. */
    const pendingImport = useSignal<Backup | null>(null);
    const confirmingClear = useSignal(false);
    const pasting = useSignal(false);
    const pasteText = useSignal("");
    /** The size of the last serialization, for the hint beside "Include photos". */
    const lastExport = useSignal<{ withPhotos: boolean; bytes: number } | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const pasteBox = useRef<HTMLTextAreaElement>(null);

    const listingCount = liveListings.value?.length ?? 0;
    const photoCount = livePhotoCount.value;

    const setStatus = (text: string, kind: LogKind = "info"): void => {
        dataStatus.value = text;
        activity.say(text, kind);
    };

    const cancel = (): void => {
        pendingImport.value = null;
        confirmingClear.value = false;
        pasting.value = false;
        pasteText.value = "";
        if (fileInput.current) fileInput.current.value = ""; // so choosing the same file again fires change
    };

    // Escape cancels a pending import or clear, unless the focus is in a field.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape" || (pendingImport.value === null && !confirmingClear.value)) return;
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target?.matches("input, textarea, select")) return;
            event.preventDefault();
            cancel();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });

    /**
     * The backup as text, with or without the photo bytes. Without them a
     * backup is a few hundred kB instead of tens of MB -- fit for the
     * clipboard, and restorable onto a database that still has the photos,
     * since an import replaces listings by id and leaves photo rows alone.
     */
    const serialize = async (): Promise<{ text: string; backup: Backup }> => {
        const full = await exportBackup();
        const backup: Backup = includePhotos.value ? full : { ...full, photos: [], listingPhotos: [] };
        const text = serializeBackup(backup);
        lastExport.value = { withPhotos: includePhotos.value, bytes: new Blob([text]).size };
        return { text, backup };
    };

    const summary = (backup: Backup, bytes: number): string => `${plural(backup.listings.length, "listing")} and ${plural(backup.photos.length, "photo")} (${bytesText(bytes)})`;

    const exportToFile = async (): Promise<void> => {
        const name = backupFilename(new Date());
        const made: { backup: Backup | null } = { backup: null };
        try {
            // The dialog opens first, inside the click that allows it; the
            // database is read only once a place was chosen.
            const outcome = await saveTextAs(name, async () => {
                const serialized = await serialize();
                made.backup = serialized.backup;
                return serialized.text;
            });
            if (outcome === "cancelled") setStatus("Export cancelled.");
            else if (made.backup) setStatus(`Exported ${summary(made.backup, lastExport.value!.bytes)} to ${name}${outcome === "downloaded" ? " in the downloads folder" : ""}.`);
        } catch (error) {
            setStatus(`Export failed: ${errorText(error)}`, "error");
        }
    };

    const exportToClipboard = async (): Promise<void> => {
        try {
            const { text, backup } = await serialize();
            await navigator.clipboard.writeText(text);
            setStatus(`Copied ${summary(backup, lastExport.value!.bytes)} to the clipboard.`);
        } catch (error) {
            setStatus(`Copy failed: ${errorText(error)}`, "error");
        }
    };

    /** Reads a backup from text, names where it came from, and asks before writing. */
    const chooseImport = (text: string, from: string): void => {
        confirmingClear.value = false;
        try {
            pendingImport.value = parseBackup(text);
            setStatus(`${from}: ready to import.`);
        } catch (error) {
            pendingImport.value = null;
            setStatus(`${from}: ${errorText(error)}`, "warn");
        }
    };

    const confirm = async (): Promise<void> => {
        if (pendingImport.value !== null) {
            const backup = pendingImport.value;
            cancel();
            setStatus("Importing…");
            try {
                const result = await importBackup(backup);
                setStatus(`Imported ${plural(result.listings, "listing")} and ${plural(result.photos, "photo")}.`);
            } catch (error) {
                setStatus(`Import failed: ${errorText(error)}`, "error");
            }
            await onChanged();
        } else if (confirmingClear.value) {
            cancel();
            await clearAll();
            setStatus("Deleted everything.");
            await onChanged();
        }
    };

    const importPasted = (): void => {
        const text = pasteText.value.trim();
        if (!text) {
            setStatus("Nothing pasted yet.", "warn");
            return;
        }
        pasting.value = false;
        chooseImport(text, "pasted text");
        pasteText.value = "";
    };

    const copyLog = (): void => {
        void navigator.clipboard.writeText(activity.text()).then(
            () => (dataStatus.value = "Log copied."),
            (error: unknown) => setStatus(`Copy failed: ${errorText(error)}`, "error"),
        );
    };

    const size = lastExport.value && lastExport.value.withPhotos === includePhotos.value ? `, ~${bytesText(lastExport.value.bytes)}` : "";
    const confirming = pendingImport.value !== null || confirmingClear.value;

    return (
        <>
            <div class="data-group">
                <h2>Back up</h2>
                <div class="data-buttons">
                    <button id="export" class="tool" type="button" onClick={() => void exportToFile()}>
                        Save to file…
                    </button>
                    <button id="copy-json" class="tool" type="button" onClick={() => void exportToClipboard()}>
                        Copy to clipboard
                    </button>
                    <label class="data-option">
                        <input
                            id="include-photos"
                            type="checkbox"
                            checked={includePhotos.value}
                            onChange={(event) => {
                                includePhotos.value = event.currentTarget.checked;
                                store(INCLUDE_PHOTOS_KEY, includePhotos.value ? "yes" : "no");
                            }}
                        />{" "}
                        Include photos
                    </label>
                    <span id="export-size" class="data-size">
                        ({plural(listingCount, "listing")}, {includePhotos.value ? plural(photoCount, "photo") : "no photos"}
                        {size})
                    </span>
                </div>
            </div>
            <div class="data-group">
                <h2>Restore</h2>
                <div class="data-buttons">
                    <button id="import" class="tool" type="button" onClick={() => fileInput.current?.click()}>
                        Open file…
                    </button>
                    <input
                        id="import-file"
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            if (file) void file.text().then((text) => chooseImport(text, file.name));
                        }}
                    />
                    <button
                        id="paste-json"
                        class="tool"
                        type="button"
                        onClick={() => {
                            cancel();
                            pasting.value = true;
                            setTimeout(() => pasteBox.current?.focus(), 0);
                        }}
                    >
                        Paste JSON…
                    </button>
                </div>
                <div id="paste-area" class="paste-area" hidden={!pasting.value}>
                    <textarea id="paste-box" ref={pasteBox} rows={6} spellcheck={false} placeholder="Paste a backup here" value={pasteText.value} onInput={(event) => (pasteText.value = event.currentTarget.value)} />
                    <div class="data-buttons">
                        <button id="import-paste" class="tool primary" type="button" onClick={importPasted}>
                            Import pasted text
                        </button>
                        <button class="tool" type="button" data-action="cancel-data" onClick={cancel}>
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
            <div class="data-group">
                <h2>Listings</h2>
                <div class="data-buttons">
                    <button
                        id="load-urls"
                        class="tool"
                        type="button"
                        onClick={() => {
                            cancel();
                            onLoadUrls();
                        }}
                    >
                        Load URLs…
                    </button>
                    <button
                        id="clear-all"
                        class="tool danger"
                        type="button"
                        onClick={() => {
                            cancel();
                            confirmingClear.value = true;
                        }}
                    >
                        Clear all
                    </button>
                </div>
            </div>
            <div id="data-confirm" class="confirm" hidden={!confirming}>
                <span id="data-confirm-text">
                    {pendingImport.value !== null
                        ? `Import ${plural(pendingImport.value.listings.length, "listing")} and ${plural(pendingImport.value.photos.length, "photo")}? Listings with the same id are replaced.`
                        : `Delete all ${plural(listingCount, "listing")}, their photos and history? This cannot be undone.`}
                </span>
                <button id="data-confirm-button" class="tool danger" type="button" data-action="confirm-data" onClick={() => void confirm()}>
                    {pendingImport.value !== null ? "Import" : "Delete everything"}
                </button>
                <button class="tool" type="button" data-action="cancel-data" onClick={cancel}>
                    Cancel
                </button>
            </div>
            <p id="data-status" class="data-status" role="status">
                {dataStatus.value}
            </p>
            <ActivityBox onCopy={copyLog} />
        </>
    );
}

/** The activity log, scrolled to its end while the reader is there. */
function ActivityBox({ onCopy }: { onCopy(): void }) {
    const box = useRef<HTMLTextAreaElement>(null);
    const pinned = useRef(true);
    const text = activity.lines.value.join("\n");
    useEffect(() => {
        if (box.current && pinned.current) box.current.scrollTop = box.current.scrollHeight;
    }, [text]);
    return (
        <div class="data-group data-activity">
            <div class="data-activity-head">
                <h2>Activity</h2>
                <button id="copy-log" class="tool" type="button" onClick={onCopy}>
                    Copy log
                </button>
                <button
                    id="clear-log"
                    class="tool"
                    type="button"
                    onClick={() => {
                        activity.clear();
                        dataStatus.value = "";
                    }}
                >
                    Clear log
                </button>
            </div>
            <textarea
                id="activity"
                ref={box}
                readOnly
                spellcheck={false}
                aria-label="Activity log"
                value={text}
                onScroll={(event) => {
                    const el = event.currentTarget;
                    // Auto-scroll only while the reader is at the end; scrolling up to read an older run must not be undone by the next line.
                    pinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
                }}
            />
        </div>
    );
}
