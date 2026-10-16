# rental-intel

Rental Intel is a Chrome extension that saves rental property listings from several online
sources to a private, in-browser, searchable database. When conducting a housing 
search that might last weeks or even months, the goal of this tool is to provide a way
of organizing and managing that process. Everything it collects stays on your device.
There is no account, no server and no tracking.

Support for each source site is implemented in the form of a plugin. This release includes
plugins only for **apartments.com** and **zillow.com**. Adding another data source requires
creating one folder of code under `src/sources/` for each new site.

## Installation

Requires Node 22.12+ and Chrome 116+

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked** and choose the `dist/` folder.

## Usage

1. **Enable a site.** Open the side panel by typing `Ctrl+Shift+Y`
   / `Cmd+Shift+Y`, or right-clicking the browser action button and choosing →
   **Show or hide Rental Intel**.

   On the **Sources** tab, click **Enable** beside a site; Chrome will ask for
   permission to access that site only. Or just browse to the site: while it
   is off, the **Listings** tab says so and offers **Enable source**.

2. **Open a rental listing** on an enabled site. The button at the top of
   the **Listings** tab says what a click would do: **Add listing**,
   **Update listing** (the page changed since the save), **Re-capture** (it
   matches), or **Try to capture** (nothing recognized). Details and photos
   are stored locally. **Show card** jumps to the page's card.

3. **Search and filter.** The search box matches any word on a listing,
   including your notes (`Cmd/Ctrl+F` jumps to it). **Filters** narrow the
   list by kind, site, type, rent, rooms, features or status, and sort it.
   The features (pets, laundry, parking and the rest) are one set shared
   with the Search tab; each site's plugin maps what its page says onto
   them when a listing is captured, so a listing saved before this needs
   a re-capture to carry them.

   Expand a card for its photos, its status and its sections: Details,
   Plans, Units, Amenities, Fees & policies, Description, Notes and Links.
   Tick cards and **Delete** removes them. Notes and status survive a
   re-save.

   The **Search** tab searches a site itself and lists what it finds, as
   links. Its filters (rent, rooms, pets, laundry, and the rest) are a set
   shared across sites; a site's form shows only the ones it can spell in
   its own search URL, and names the rest.

4. **Load a list.** **Load URLs…** on the **Data** tab takes listing URLs,
   one per line, or a text file of them. **Check list** reports what it
   found; **Start** visits each one in the active tab and saves it. A page
   that is not recognized in time stops the run: answer the site's check in
   the tab, or **Skip** the page.

5. **Back up.** **Save to file…** writes a JSON backup and **Open file…**
   restores one; **Copy to clipboard** and **Paste JSON…** do the same
   through the clipboard. Import merges by listing. The **Activity** log
   records what the extension did.

6. **Options.** Panel size, page timing for list runs, how many photos to
   save, the status a new listing starts with, and which Details rows show.
   Ctrl or ⌘ with `+`, `-` and `0` resize the panel while it has the focus.

## Tips

- A site is off until you enable it. Disabling it on the Sources tab gives
  the access back to Chrome; your saved listings stay.
- Sites change their pages. The **Sources** tab says when each site's
  reader was last checked. When a site stops being recognized, the panel
  offers **Try to capture**, which still attempts to save what it can.

## Development

* `npm run build` writes the extension to `dist/`
* `npm run build:watch` keeps it current while you work
* `npm run test:unit` is the fast loop (vitest)
* `npm run playwright:test` the browser suite against a synthetic site
* `npm run site:dev` serves the invented rental site the example source
  reads at http://localhost:5174, where a test build of the extension can
  capture from it; `npm run site:build` writes it to `site/dist/` for the
  browser harness. `SITE_ORIGIN` at build time moves both to another address
* `npm run docs` the API references

A source is one folder, `src/sources/<id>/`: a descriptor (hosts, URL
shapes, search filters), a page module (detection and extraction over the
live document, including how the page's wording maps onto the shared
filter vocabulary) and a view (how its details render on a card). The
`example` source is the template, and its fixtures under
`playwright/fixtures/` show what each part reads.

### Design

- The extension drives the user's own active tab and never fetches a
  listing page itself: the sites' bot detection accepts only a browser
  showing a page to a person, and a hidden tab gets no animation frames.
- The database (IndexedDB) lives in the extension origin. The side
  panel reads it with live queries and the service worker writes it;
  content scripts only answer questions about their page.
- A page is confirmed as a listing when its URL names one and the page's
  own checks (structured data, canonical link, layout markers) add up to
  the same listing. A manual capture needs only a listing id.

## License

[MIT](LICENSE)
