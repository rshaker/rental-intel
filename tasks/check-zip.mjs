#!/usr/bin/env node
/**
 * Checks the store zip after `npm run zip` writes it: no source maps, a
 * manifest whose version is package.json's, the release name, and the
 * sites' hosts under optional_host_permissions only. Exits 1 with the
 * reasons when any check fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ZIP = resolve(ROOT, "rental-intel-chrome.zip");

const entries = execFileSync("unzip", ["-Z1", ZIP], { encoding: "utf8" }).split("\n").filter(Boolean);
const manifest = JSON.parse(execFileSync("unzip", ["-p", ZIP, "manifest.json"], { encoding: "utf8" }));
const version = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;

const problems = [];
const maps = entries.filter((entry) => entry.endsWith(".map"));
if (maps.length) problems.push(`source maps in the zip: ${maps.join(", ")}`);
const junk = entries.filter((entry) => /(^|\/)\.DS_Store$/.test(entry));
if (junk.length) problems.push(`stray files in the zip: ${junk.join(", ")}`);
if (manifest.version !== version) problems.push(`manifest version ${manifest.version} is not package.json's ${version}`);
if (manifest.name !== "Rental Intel") problems.push(`manifest name is "${manifest.name}", not the release name`);
if (manifest.host_permissions !== undefined) problems.push(`host_permissions is set (${JSON.stringify(manifest.host_permissions)}); a release carries only optional_host_permissions`);
const hosts = manifest.optional_host_permissions ?? [];
if (hosts.length === 0) problems.push("optional_host_permissions is empty");
const test = hosts.filter((host) => /localhost|example/.test(host));
if (test.length) problems.push(`test hosts in optional_host_permissions: ${test.join(", ")}`);

if (problems.length) {
    console.error(`rental-intel-chrome.zip failed ${problems.length} check${problems.length === 1 ? "" : "s"}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
console.log(`rental-intel-chrome.zip: ${entries.length} entries, manifest ${manifest.version}, hosts ${hosts.join(" ")}.`);
