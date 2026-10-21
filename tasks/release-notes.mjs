#!/usr/bin/env node
/**
 * Prints the notes for a GitHub Release: the CHANGELOG.md section for one
 * version, after a line saying what the attached zip is.
 *
 *   node tasks/release-notes.mjs 0.2.0 > notes.md
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const version = process.argv[2];
if (!version) {
    console.error("Usage: node tasks/release-notes.mjs <version>");
    process.exit(2);
}

const lines = readFileSync(resolve(import.meta.dirname, "..", "CHANGELOG.md"), "utf8").split("\n");
const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
if (start < 0) {
    console.error(`CHANGELOG.md has no section for ${version}.`);
    process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
if (end < 0) end = lines.length;
const section = lines.slice(start + 1, end).join("\n").trim();

process.stdout.write(
    `The attached \`rental-intel-chrome-${version}.zip\` is the extension itself. Unzip it and load the folder unpacked, as the [README](https://github.com/rshaker/rental-intel#installation) describes. The two source-code archives are the repository at this tag.\n\n${section}\n`,
);
