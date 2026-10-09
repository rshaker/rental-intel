import { runContentScript } from "../../content/lifecycle";
import { zillowPage } from "./page";

/**
 * The Zillow content script. Started from `onExecute`, not the module body:
 * CRXJS's loader `import()`s this module and calls `onExecute` on every
 * injection, while the module body runs once per isolated world. That is
 * what lets the worker restart a stopped script.
 */
export function onExecute(): void {
    runContentScript(zillowPage);
}
