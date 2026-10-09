# Rental Intel

A Chrome extension that saves rental listings from several sites into one
local, searchable list, so a search that runs for weeks doesn't depend on
browser tabs and memory. One click in its side panel saves a listing's
details and photos to your computer; the panel holds everything you've
saved, from every site, with your own status, notes and links on each, and
a search box over all of it.

Everything stays on your device. There is no account, no server and no
tracking. See the [privacy policy](docs/privacy-policy.md).

Sites are plugins. This release carries **Apartments.com** and **Zillow**;
adding another is one folder of code under `src/sources/`.

## Install

**From source.** You need Node 22.12 or newer and Chrome 116 or newer.

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked** and choose the `dist/` folder.

## Use

1. **Turn on a site.** Open the side panel (toolbar button, `Ctrl+Shift+Y`
   / `Cmd+Shift+Y`, or right-click → **Show or hide Rental Intel**), go to
   the **Sources** tab and click **Enable** beside a site. Chrome asks once
   for access to that site only. Nothing happens on a site until you do this.

2. **Open a rental listing** on an enabled site. The row at the top of the
   panel's **Listings** tab says what the tab is showing and what saving
   would do:

   | Button | Meaning |
   | --- | --- |
   | **Add listing** | a listing that has not been saved yet |
   | **Update listing** | a saved listing whose page now differs from what is stored |
   | **Re-capture** | a saved listing that matches what is stored |
   | **Try to capture** | no listing recognised here; a click still tries, and reports if nothing is found |

   Details (name, address, rent, beds and baths, floor plans and units,
   amenities, fees, description) and photos are stored locally. Saving again
   later records what changed. **Show card** opens the card of the listing
   the current tab is showing.

3. **Search and work the list.** The search box finds listings by any word
   the site or you wrote on them: a street, a neighbourhood, an amenity, a
   phrase in the description, a word in your notes (`Cmd/Ctrl+F` jumps to
   it; quote a phrase to match it whole). The **Filters** under the search
   box narrow the list to homes or buildings, one site, a rent range, a minimum
   of bedrooms or bathrooms, or a status, and sort by rent, bedrooms, size,
   name, address, site or date. Expand a card for its photos, its **status**
   (none, interested, not interested, scheduled, visited, applied,
   rejected), and its sections: Details, Plans, Units, Amenities, Fees &
   policies, Description, your Notes and your Links. When the same place is
   saved from two sites, each card says **Also on …** with a jump to the
   other. Your notes and status are never overwritten by a re-save. Each
   card has a checkbox; **Delete** removes the selected cards. The panel
   remembers everything, including which cards and sections are open.

4. **Load a list.** **Load URLs…** on the **Data** tab opens a dialog.
   Paste listing URLs from any enabled site, one per line, or choose a text
   file of them. **Check list** reports what it found, then **Start** opens
   the tab beside the panel and visits each listing in turn, saving it exactly as
   a click would. Listings you already have are skipped. A page that is not
   recognised in time makes the run stop and wait on you: if the site is
   asking you to prove you are a person, answer it in the tab and the run
   carries on by itself; otherwise **Retry** the page or **Skip** it. **Pause** finishes the
   current listing and waits; **Cancel** ends the run. A search on the
   Search tab waits the same way.

5. **Back up.** **Save to file…** asks where to put the backup and what to
   call it; **Copy to clipboard** puts the same JSON on the clipboard, and
   **Paste JSON…** takes it back. Untick **Include photos** for a small
   backup of the listings alone. **Open file…** restores from a file. Import
   merges by listing, so importing the same backup twice changes nothing.
   Everything the tab does, each line of a Load URLs run, and any warning
   from the extension is kept in the **Activity** log below the buttons.

6. **Options.** The **Options** tab holds the knobs: the size the panel is
   drawn at, how long a page gets to load during a list run and the pause
   between pages, whether photos are saved and how many, the status a new
   listing starts with, and which rows the Details section shows. The same
   page opens from **Extension options** on `chrome://extensions`. The size
   also answers the keys that zoom a page, Ctrl or ⌘ with `+`, `-` and `0`,
   while the panel has the focus; Chrome's own zoom cannot reach a side
   panel.

## Good to know

- A site is off until you enable it. Disabling it on the Sources tab gives
  the access back to Chrome; your saved listings stay.
- Sites change their pages. The **Sources** tab says when each site's
  reader was last checked. When a site stops being recognised, the panel
  offers **Try to capture**, which still saves what it can.
- Saved photos add up. A large building can store fifty or more full-size
  images; the Photos setting caps that.

## Development

`npm run build` writes the extension to `dist/`; `npm run build:watch`
keeps it current while you work. `npm run test:unit` is the fast loop
(vitest), `npm run playwright:test` the browser suite against a synthetic
site, `npm run docs` the API reference.

A source is one folder, `src/sources/<id>/`: a descriptor (hosts, URL
shapes, search filters), a page module (detection and extraction over the
live document) and a view (how its details render on a card). The `example`
source is the template, and its fixtures under `playwright/fixtures/` show
what each part reads.

## License

[MIT](LICENSE)
