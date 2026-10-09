import { render } from "preact";
import { installConsoleHandle } from "../lib/consoleHandle";
import { setLogSink } from "../lib/log";
import { announcePanel } from "../lib/panelPresence";
import { activity } from "./activityLog";
import { App } from "./components/App";
import { watchScale } from "./scale";

/** The side panel's entry. */

installConsoleHandle();
setLogSink((level, text) => activity.say(`panel: ${text}`, level));
announcePanel();
watchScale();

render(<App />, document.getElementById("app")!);
