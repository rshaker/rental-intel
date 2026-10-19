# Release checks

What to run by hand before a build goes to the Chrome Web Store. The
automated suites cover the code against fixtures, including most of what
the panel does with a list once it is saved; these steps cover the live
sites, Chrome's own behaviour, and the one prompt an upgrade can show,
which no fixture can. Budget about twenty-five minutes.

Each step says what to do and what to expect. A step that does not behave
as written is a release blocker until it is explained.

## 1. Build and load

1. Run `npm run test`. Both the unit suite and the browser suite pass. The
   browser suite includes `playwright/specs/release.spec.ts`, which runs
   the list, backup and options checks that used to be in this document;
   section 5 says which.
2. Run `npm run zip`. It typechecks, builds `dist/` in release mode, writes
   `rental-intel-chrome.zip` and checks it: no `.map` files, a
   `manifest.json` carrying package.json's version and the release name,
   and only the real sites' hosts, under `optional_host_permissions`. A
   failed check names the reason and the script exits with an error.
3. In Chrome, create a new profile for the test, so no earlier state is in
   the way. Open `chrome://extensions`, turn on Developer mode, click Load
   unpacked and choose `dist/`. The card shows the new version, and no
   errors button appears on it.
4. Press `Ctrl+Shift+Y` (`Cmd+Shift+Y` on a Mac). The side panel opens on
   the Listings tab with an empty list. Press it again: the panel closes.
   Right-click the toolbar button: the menu offers Show or hide Rental
   Intel.

## 2. Sources

5. On the Sources tab, both sites show Disabled with a Checked-against date
   that is the current release's. Click Enable beside Zillow. Chrome asks
   for access to zillow.com only; accept. The row reads Enabled.
6. Enable Apartments.com the same way.
7. Click Disable beside Zillow. The row reads Disabled, and a Zillow
   listing opened now is not recognised: the Listings tab offers Enable
   source instead. Click Enable on the Sources tab. Chrome does not ask
   again, because it remembers a permission the user has already accepted;[^1]
   the row reads Enabled and the listing is recognised once its tab is
   reloaded. A row that instead says Chrome kept the site's access means
   the loaded build is the test build, whose hosts are required.

## 3. Zillow, live

8. Open a building page on Zillow, one with several floor plans. Within a
   few seconds the Listings tab's top row reads Add listing. Click it. The
   row reads Saved, then Saved alone once the photos are in. The card opens
   with photos, a rent range, Studio or bedroom range, a Plans section with
   more than one plan, a Units section, Amenities, Fees & policies and a
   Description.
9. With the panel still open and the saved listing in the tab beside it,
    click Disable beside Zillow on the Sources tab, then reload that tab so
    the page loads without the extension's script.[^2] Switch to the Listings
    tab: it says the site is off and offers Enable source. Click it. No
    prompt appears, since Chrome remembers the earlier grant, and after one
    more reload of the tab the top row reads Re-capture for the saved
    listing.
10. Open a single home on Zillow, a house or a condo. Add listing. The card
    is titled by its address, with one rent, one bedroom count and no Plans
    section. If the home belongs to a building that is already saved, the
    card says In and names the building; the building's card lists the home
    under its units.
11. On the Search tab, type a city into the Zillow row, set Beds to 2+ and
    tick one feature, and click Search. The tab beside the panel lands on
    Zillow's results with the filters applied, and the panel lists the
    results with prices and facts. Click one result: the tab opens it and
    the top row offers Add listing.

## 4. Apartments.com, live

12. Open a community page on Apartments.com. Add listing. Each floor plan
    appears once in the Plans section, not once per bedroom tab, and the
    Units section lists the available units with their numbers.
13. Open a single-unit page, one whose title ends in a unit designation
    such as Unit 101. Add listing. The card is a home titled by its address
    with the unit, with one rent and no Plans section, and Fees & policies
    does not list the pet policy as a fee.
14. Open a house page. Add listing. The card is a home titled by its
    address, with its rent, rooms and size.
15. On the Search tab, run a search in the Apartments.com row with a rent
    maximum and a pet ticked. The results come in from more than one page
    when the search is broad, the Show dropdown counts homes and buildings
    separately, and Add to listings offers to save the results through
    Load URLs.
16. With the live listings saved, open one card and look it over against
    its page: the photos, the rent, the rooms, the address and the
    amenities match what the site shows. The suite checks the same card
    against fixtures; this is the one look at a card drawn from today's
    page.

## 5. What the browser suite covers

These used to be steps here. They run in `npm run test`, against the
invented site's fixtures, and need no hands. The spec names say where to
look when one fails.

- Search by a word from a description or a note, `Ctrl+F` to the search
  box, the kind, site, rent, feature and status filters with the count
  beside Filters, and the rent and date sorts: `panel.spec.ts` and
  `release.spec.ts`.
- An open card's sections, status and notes, a re-capture of an unchanged
  page leaving them alone, and a re-capture of a changed page saving again,
  advancing the Updated date and leaving them alone: `panel.spec.ts` and
  `release.spec.ts`. A re-capture of a page that has not changed reports
  Already up to date and fetches nothing, photos included.
- The same place saved from two sites, each card saying Also on the other
  and the link opening the other card: `release.spec.ts`.
- Thumbnail and Full-sized photos, the carousel's arrows and arrow keys:
  `release.spec.ts`.
- Selecting two cards and deleting them: `panel.spec.ts`.
- Load URLs with a saved URL skipped and a dead one reported as a failure
  without ending the run: `bulk.spec.ts`.
- Save to file, Open file and the clipboard round trip, including a deleted
  listing returning with its status, note and photos and the rest not
  duplicated, and the Activity log recording it all: `panel.spec.ts` and
  `release.spec.ts`.
- The Size setting and `Ctrl+0`, the photo limit on the next save, the
  status a new listing starts with, a Details row switch emptying that row
  from every card, and the panel following the system colour scheme
  without a reload: `settings.spec.ts` and `release.spec.ts`.

## 6. Upgrade from the previous release

17. Run `npm run playwright:upgrade`. It builds this release's test build
    and the previous release's, from the newest `vX.Y.Z` tag in this
    branch's history with another version, in a git worktree under
    `work/previous/` (the first run installs that tree's dependencies, which
    takes a minute). The spec saves a listing with the previous build, swaps
    in this one, reloads the extension and finds the listing with its
    status and note, on the current schema.
18. Only when the new manifest asks for a permission under `permissions`
    that the previous release did not, and the previous release had
    installs beyond your own: in another new profile, load the previous
    release's zip unpacked, then replace the folder's contents with the new
    build and click the reload icon on `chrome://extensions`. Chrome
    disables the extension and shows a prompt to accept the new permission;
    accept, and the extension is enabled again.[^3]

## 7. Store assets

19. Run `npm run store:artwork`. Seven images appear in `work/store/`, and
    the captions in them match what the release does.
20. Read the listing text once more before pasting it into the developer
    dashboard, with the changelog open beside it.

## Notes

[^1]: Chrome keeps a record of every permission the user has accepted for
    an extension. `chrome.permissions.remove()` takes the permission away
    from the extension, but a later `chrome.permissions.request()` for the
    same permission is granted without a prompt, because the warning it
    would show is one the user has already seen. A prompt appears only for
    a warning the user has not accepted yet, such as a new host. See the
    [permissions reference](https://developer.chrome.com/docs/extensions/reference/api/permissions).

[^2]: Two things guarantee it. Chrome injects a content script only on a
    host the extension holds permission for, so once `zillow.com` is
    withdrawn nothing runs there whatever the extension asks. And the
    worker's listener for a removed permission (`src/worker/sources.ts`)
    unregisters the site's content script, so the registration is gone
    too. The reload matters because withdrawing a permission does not stop
    a script already running in the tab. The Listings tab is the evidence:
    it decides what to show by messaging the tab's script, and Enable
    source means nothing answered. To see it directly, open DevTools on
    the page and look under Sources, Content scripts, where no Rental Intel
    entry is listed, or run this in the service worker's console:

    ```js
    await chrome.scripting.getRegisteredContentScripts()
    ```

    It lists no `source:zillow` entry while the site is off.

[^3]: When an update's manifest asks for a permission the installed version
    did not have, Chrome disables the extension until the user accepts the
    new warning, with a prompt on the extensions page and in the toolbar
    menu. Optional permissions, which this extension uses for the sites,
    do not trigger it; a new entry under `permissions` does, as `tabs` did
    in 0.2.0. The upgrade spec cannot see this prompt, which is why the
    step stays manual. The reload icon matters for another reason too:
    until an unpacked extension is reloaded, Chrome keeps running the
    service worker it registered for the old files, even though it reports
    the new manifest. A Web Store update reloads on its own.
