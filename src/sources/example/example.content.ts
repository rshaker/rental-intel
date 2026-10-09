import { runContentScript } from "../../content/lifecycle";
import { examplePage } from "./page";

/**
 * The example source's content script. Registered on listings.example by the
 * worker when the source is enabled (src/worker/sources.ts); everything it
 * does is the generic lifecycle in src/content/lifecycle.ts. Started from
 * `onExecute`; see zillow.content.ts for why.
 */
export function onExecute(): void {
    runContentScript(examplePage);
}
