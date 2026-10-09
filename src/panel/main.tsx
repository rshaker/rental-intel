import { render } from "preact";
import { installDataDebugHandle } from "../lib/debug.data";
import { Logger } from "../lib/logging";
import { announcePanel } from "../lib/panelPresence";
import { activity } from "./activityLog";
import { App } from "./components/App";
import { bootScale, watchScale } from "./scale";

/** The side panel's entry: wires the page-level services, then mounts the App. */

// The size the panel was last drawn at, before anything is painted. See scale.ts.
bootScale();
installDataDebugHandle("extension-page");
// Warnings and errors this page logs go to the activity log directly; other
// contexts' arrive by message. Set after the handle, which installs the
// forwarding sink for contexts that need one.
Logger.sink = (level, text) => activity.say(`panel: ${text}`, level);
announcePanel();
watchScale();

render(<App />, document.getElementById("app")!);
