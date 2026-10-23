/**
 * Chooses the example site for an extension build before
 * src/sources/example/origin.ts reads the choice: manifest.config.ts imports
 * this first. Other Node callers (the harness, the site build) import
 * site-origin.mjs instead, which takes the environment alone and so keeps
 * the dev server as the default.
 */
import { extensionSiteOrigin } from "../src/sources/example/siteOrigins.js";

globalThis.__SITE_ORIGIN__ = extensionSiteOrigin(process.env);
