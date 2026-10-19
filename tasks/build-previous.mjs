#!/usr/bin/env node
/**
 * Builds the previous release's test build for the upgrade spec
 * (playwright/upgrade/). Releases are the `vX.Y.Z` tags; the previous
 * release is the newest tag in this branch's history whose version is not
 * package.json's. It is checked out as a git worktree under work/previous/,
 * given its own `npm ci`, and built with its own `build:e2e`. A second run
 * with the same release already built does nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DIR = resolve(ROOT, "work", "previous");
const STAMP = resolve(DIR, ".built-from");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

const current = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version;
// Newest first; only tags reachable from HEAD, so a release branch sees its own line.
const releases = git("tag", "--list", "v[0-9]*", "--merged", "HEAD", "--sort=-v:refname")
    .split("\n")
    .filter(Boolean)
    .map((tag) => ({ tag, version: tag.slice(1), sha: git("rev-parse", `${tag}^{commit}`) }));
const previous = releases.find((release) => release.version !== current);
if (!previous) {
    console.error(`No release tag before ${current} in this branch's history: nothing to upgrade from.`);
    process.exit(1);
}

if (existsSync(STAMP) && readFileSync(STAMP, "utf8") === previous.sha && existsSync(resolve(DIR, "dist-e2e", "manifest.json"))) {
    console.log(`Previous release ${previous.version} (${previous.tag}, ${previous.sha.slice(0, 7)}) is already built in ${DIR}.`);
    process.exit(0);
}

// A stale worktree, or a plain folder left behind, goes before the checkout.
const worktrees = git("worktree", "list", "--porcelain");
if (worktrees.includes(`worktree ${DIR}`)) git("worktree", "remove", "--force", DIR);
else if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
git("worktree", "prune");

console.log(`Building release ${previous.version} (${previous.tag}, ${previous.sha.slice(0, 7)}) in ${DIR}…`);
git("worktree", "add", "--detach", DIR, previous.sha);
run("npm", ["ci", "--no-audit", "--no-fund"], DIR);
run("npm", ["run", "build:e2e"], DIR);
writeFileSync(STAMP, previous.sha);
console.log(`Built ${previous.version} into ${resolve(DIR, "dist-e2e")}.`);
