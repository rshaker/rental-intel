import { runContentScript } from "../../content/lifecycle";
import { apartmentsPage } from "./page";

/** The apartments.com content script. Registered on *.apartments.com when the source is enabled. Started from `onExecute`; see zillow.content.ts for why. */
export function onExecute(): void {
    runContentScript(apartmentsPage);
}
