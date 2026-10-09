/**
 * Saving text to a file the user names and places. The File System Access
 * API gives Chrome's own Save As dialog from an extension page with no extra
 * permission (the `downloads` permission would add a "manage your downloads"
 * warning for the same result), pre-fills the name, and reopens the folder
 * chosen last time under the same `id`. A browser without the API gets the
 * plain download, which lands in the downloads folder under the suggested
 * name -- and the caller is told which happened, so it can say so.
 */

export type SaveOutcome = "saved" | "cancelled" | "downloaded";

interface SavePicker {
    (options: { suggestedName: string; id: string; types: { description: string; accept: Record<string, string[]> }[] }): Promise<{
        createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
    }>;
}

const PICKER_ID = "rental-intel-backup";

/** What kind of file is being saved: the picker's filter, and the type a plain download carries. */
export interface FileKind {
    description: string;
    mime: string;
    extension: string;
}

const JSON_BACKUP: FileKind = { description: "JSON backup", mime: "application/json", extension: ".json" };
export const URL_LIST: FileKind = { description: "URL list", mime: "text/plain", extension: ".txt" };

/**
 * Opens the dialog first, so it runs inside the click that allowed it, then
 * asks for the text: a 13 MB serialization is not paid for on a cancel.
 */
export async function saveTextAs(suggestedName: string, text: () => Promise<string>, kind: FileKind = JSON_BACKUP): Promise<SaveOutcome> {
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (typeof picker !== "function") {
        download(await text(), suggestedName, kind);
        return "downloaded";
    }
    let handle;
    try {
        handle = await picker({ suggestedName, id: PICKER_ID, types: [{ description: kind.description, accept: { [kind.mime]: [kind.extension] } }] });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
        throw error;
    }
    const writable = await handle.createWritable();
    try {
        await writable.write(await text());
    } finally {
        await writable.close();
    }
    return "saved";
}

function download(text: string, name: string, kind: FileKind): void {
    const url = URL.createObjectURL(new Blob([text], { type: kind.mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    // Revoking at once can abort the download Chrome has just started.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
