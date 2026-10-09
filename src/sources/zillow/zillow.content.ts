import { runContentScript } from "../../content/lifecycle";
import { zillowPage } from "./page";

/**
 * The Zillow content script. Registered on *.zillow.com when the source is
 * enabled.
 *
 * Started from `onExecute`, not from the module body: the file Chrome runs is
 * CRXJS's loader, which `import()`s this module and then calls `onExecute`.
 * The module body runs once per isolated world -- a second injection into
 * the same world gets the cached module -- while `onExecute` runs on every
 * injection, which is what lets the worker restart a script that has stood
 * down (see runContentScript on takeover).
 */
export function onExecute(): void {
    runContentScript(zillowPage);
}
