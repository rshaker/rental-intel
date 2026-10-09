import { runContentScript } from "../../content/lifecycle";
import { apartmentsPage } from "./page";

/** The apartments.com content script. Started from `onExecute`; see zillow.content.ts for why. */
export function onExecute(): void {
    runContentScript(apartmentsPage);
}
