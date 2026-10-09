import { runContentScript } from "../../content/lifecycle";
import { examplePage } from "./page";

/** The example source's content script. Started from `onExecute`; see zillow.content.ts for why. */
export function onExecute(): void {
    runContentScript(examplePage);
}
