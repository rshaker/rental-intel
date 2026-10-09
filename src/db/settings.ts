import { db } from "./db";
import { defaultRows, settingsFrom, type SettingKey, type SettingValue, type Settings } from "./settingsSchema";

/** Reading and writing the `settings` table; the registry is settingsSchema.ts. Read at the point of use, so a change takes effect on the next save or run. */

export function getSettings(): Promise<Settings> {
    return db.settings.toArray().then(settingsFrom);
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    return (await getSettings())[key] as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
    await db.settings.put({ key, value });
}

/** Puts every setting back to its registry default. */
export async function resetSettings(): Promise<void> {
    await db.settings.bulkPut(defaultRows());
}
