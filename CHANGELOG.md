# Changelog

All notable changes to this project are recorded here. The format is
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Database schema
versions are Dexie's, independent of the release version.

## [Unreleased]

### Added

- The invented rental site has a dark theme, in the documentation site's
  colours, so the two read as one. It follows the system setting, or the
  theme chosen in the documentation's Settings when that is set. Its home
  page now explains why the site exists.
- The documentation's toolbar links to the GitHub repository and to the
  invented rental site.
- A GitHub Release for every pushed `vX.Y.Z` tag, made by a workflow: the
  extension zip, named with the version, is attached to the tag, and the
  changelog's section for that version is the notes. The README explains
  installing from such a zip.
- The invented rental site is published with the documentation, at
  https://rshaker.github.io/rental-intel/site/, so a test build made with
  that `SITE_ORIGIN` can capture from it without a local server. The site
  now writes a page under every city-suffixed search slug, and its 404 page
  sends any other search slug to the all-listings page, which is what the
  dev server's route table did for a static host that cannot run it.

## [0.2.0] - 2026-10-17

### Added

- An invented rental site under `site/`: about thirty fictional Austin, TX
  listings with generated photos, built by Vite and served at
  http://localhost:5174, where the test build captures from it. The browser
  harness serves the same files without a server. It gives the example
  source a whole city to read, so screenshots and tests need no real site's
  data. `SITE_ORIGIN` at build time moves the site and the source together,
  base path included.
- `npm run store:artwork` builds the test extension and the site and writes
  the Chrome Web Store screenshots and tiles to `work/store/`, captured from
  the invented site.
- A shared list of listing features, used two ways:
  - The Search tab offers the features a site's search accepts, and the
    site's plugin translates them into its search URL. Searches can now
    filter by housing type, laundry, amenities, and keywords.
  - Every saved listing has a field, `core.features`, that the plugin fills
    at capture. The Listings tab filters by it; the Details view shows it.
- An **Enable source** button on the Listings tab, shown when the active
  tab is on a site that is turned off.
- Restoring a backup accepts the first backup format too.
- A manual release checklist, `docs/release-checks.md`, covering the live
  sites, Chrome's behaviour and the upgrade from the previous release.
- `playwright/specs/release.spec.ts` runs the checklist's list, backup and
  options steps in the browser suite: the search shortcut, the status
  filter and date sorts, a re-capture of a changed page, one place saved
  from two sites, the carousel, a backup restoring a deleted listing whole,
  the photo limit and the colour scheme.
- `npm run playwright:upgrade` builds the previous release in a git
  worktree under `work/previous/`, saves a listing with it, swaps in the
  current build and checks that the listing and its edits survive on the
  current schema.
- `npm run zip` now checks the zip it writes: no source maps, the version
  from package.json, the release name, and the sites' hosts under
  `optional_host_permissions` only.

### Changed

- Schema version 4 adds `core.features` to every saved listing. It stays
  empty until the listing is captured again.
- Schema version 3 removes the `captures` and `snapshots` tables and the
  stored relation fields, which the panel now computes. `via` is renamed
  `readMethod`. Backups are now format version 2.
- The manifest asks for the `tabs` permission, so the panel can read the
  active tab's address before the user grants the site. Chrome disables the
  extension after a store update until the user accepts it.
- The panel's zoom level is kept only in `localStorage`.
- The console object `__intel` is now `{ db, upsert, getSettings, setSetting }`.
- The README and the privacy policy are rewritten, and the package
  description says in one sentence what the extension does.

### Fixed

- An Apartments.com building no longer lists each floor plan once per
  bedroom tab. The page repeats its pricing grid under All, Studio, 1 Bed
  and so on, and every copy was read; now only the All tab is.
- An Apartments.com page for a single unit, which the site lays out as a
  community, is read as a home with its unit designation, such as
  "5511 Guadalupe St Unit 101", instead of as a building with no unit.
- The Apartments.com pet policy no longer appears among a listing's fees.

### Removed

- The options page. The Options tab in the panel remains.
- Pause and retry in Load URLs.
- The dependencies `zod` and `p-limit`.

## [0.1.0] - 2026-10-08

### Added

- First release: Chrome side panel; Zillow and apartments.com sources;
  capture from the active tab; Load URLs; site search; photos; backups.
- Schema v1 (`listings`, `captures`, `snapshots`, `photos`,
  `listingPhotos`, `settings`); v2 added the stored relation fields.
