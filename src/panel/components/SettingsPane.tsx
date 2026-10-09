import "./SettingsPane.css";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { resetSettings, setSetting } from "../../db/settings";
import { SECTIONS, SETTINGS, isValidValue, keysInSection, type SettingKey, type SettingSpec, type Settings } from "../../db/settingsSchema";
import { liveSettings } from "../live";
import { DEFAULT_SCALE, PANEL_SCALES, parseScale, scale } from "../scale";

/** The Options tab: the panel's size, then the settings registry rendered section by section. Each control writes on change. */
export function SettingsPane() {
    const settings = liveSettings.value;
    const status = useSignal("");
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const say = (text: string): void => {
        status.value = text;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => (status.value = ""), 2500);
    };

    const write = async <K extends SettingKey>(key: K, value: unknown): Promise<boolean> => {
        if (!isValidValue(key, value)) return false;
        await setSetting(key, value);
        say(`Saved ${SETTINGS[key].label.toLowerCase()}.`);
        return true;
    };

    const reset = async (): Promise<void> => {
        await resetSettings();
        scale.value = DEFAULT_SCALE;
        say("Every setting is back to its default.");
    };

    return (
        <>
            <section class="settings-section">
                <h2>Appearance</h2>
                <p class="hint">How the side panel is drawn.</p>
                <div class="setting">
                    <label>
                        <span class="setting-label">Size</span>
                        <select
                            data-setting="appearance.scale"
                            value={scale.value}
                            onChange={(event) => {
                                const next = parseScale(event.currentTarget.value);
                                if (!next) return;
                                scale.value = next;
                                say("Saved size.");
                            }}
                        >
                            {PANEL_SCALES.map((stop) => (
                                <option key={stop} value={stop}>{`${stop}%`}</option>
                            ))}
                        </select>
                    </label>
                    <p class="setting-help">Makes everything in the panel larger or smaller. Ctrl (⌘ on a Mac) with + or − steps it from anywhere in the panel, and with 0 puts it back. Default: 100%.</p>
                </div>
            </section>
            {Object.keys(SECTIONS).map((section) => {
                const keys = keysInSection(section);
                if (keys.length === 0) return null;
                return (
                    <section key={section} class="settings-section">
                        <h2>{SECTIONS[section]!.label}</h2>
                        <p class="hint">{SECTIONS[section]!.help}</p>
                        {keys.map((key) => (
                            <Setting key={key} settingKey={key} settings={settings} say={say} write={write} />
                        ))}
                    </section>
                );
            })}
            <div class="settings-footer">
                <button type="button" class="tool" data-action="reset-settings" onClick={() => void reset()}>
                    Reset to defaults
                </button>
                <p class="settings-status" role="status">
                    {status}
                </p>
            </div>
        </>
    );
}

interface SettingProps {
    settingKey: SettingKey;
    settings: Settings;
    say(text: string): void;
    write(key: SettingKey, value: unknown): Promise<boolean>;
}

function Setting({ settingKey: key, settings, say, write }: SettingProps) {
    const spec: SettingSpec = SETTINGS[key];
    const stored = settings[key];
    const help = `${spec.help} Default: ${describe(spec, spec.default)}.`;

    let control;
    if (spec.type === "number") {
        control = (
            <label>
                <span class="setting-label">{spec.label}</span>
                <input
                    type="number"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    data-setting={key}
                    value={String(stored)}
                    onChange={(event) => {
                        const input = event.currentTarget;
                        void write(key, input.valueAsNumber).then((ok) => {
                            if (ok) return;
                            input.value = String(stored); // the value prop did not change, so put the text back by hand
                            say(`${spec.label} must be between ${spec.min} and ${spec.max}.`);
                        });
                    }}
                />
            </label>
        );
    } else if (spec.type === "boolean") {
        control = (
            <label class="setting-toggle">
                <input type="checkbox" data-setting={key} checked={stored as boolean} onChange={(event) => void write(key, event.currentTarget.checked)} />
                <span class="setting-label">{spec.label}</span>
            </label>
        );
    } else {
        control = (
            <label>
                <span class="setting-label">{spec.label}</span>
                <select data-setting={key} value={stored as string} onChange={(event) => void write(key, event.currentTarget.value)}>
                    {spec.options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
        );
    }

    return (
        <div class="setting">
            {control}
            <p class="setting-help">{help}</p>
        </div>
    );
}

/** A setting's value the way the page shows it, for the "Default:" note. */
function describe(spec: SettingSpec, value: unknown): string {
    switch (spec.type) {
        case "number":
            return spec.unit ? `${String(value)} ${spec.unit}` : String(value);
        case "boolean":
            return value ? "on" : "off";
        case "select":
            return spec.options.find((option) => option.value === value)?.label ?? String(value);
    }
}
