/**
 * Zillow's page-world helper. Runs in the page's own JavaScript world (the
 * worker registers it with `world: "MAIN"`), where the extension's APIs do
 * not exist but the page's globals do.
 *
 * Why it exists: Zillow is a Next.js (pages router) single-page app. The
 * `<script id="__NEXT_DATA__">` the content script reads is written once,
 * when the document loads, and describes *that* page. Move to another
 * listing in-page -- a "similar homes" click, the browser's Back -- and the
 * document keeps the first page's payload while the router holds the new
 * one in memory. A capture then reads the wrong listing's data or none.
 *
 * What it does: after every client-side route change (and once on start,
 * for a tab the extension was enabled on late), it copies the current
 * route's props out of `window.next.router` into a `<script>` element of
 * its own, `#__intel_zillow_state`, as JSON. The DOM is shared between
 * worlds, so the content script reads that element the way it reads
 * `__NEXT_DATA__`, and prefers it (see HYDRATION_SELECTORS).
 *
 * Everything is defensive: a page without the router, or a router whose
 * shape has moved on, leaves no element and no error, and the content
 * script falls back to `__NEXT_DATA__` as before. No page globals are
 * modified.
 */
(() => {
    const ELEMENT_ID = "__intel_zillow_state";
    const FLAG = "__intelZillowMain";
    const page = window as unknown as Record<string, unknown>;
    if (page[FLAG]) return;
    page[FLAG] = true;

    interface NextRouter {
        route?: string;
        pathname?: string;
        components?: Record<string, { props?: unknown } | undefined>;
        events?: { on?: (event: string, handler: () => void) => void };
    }

    function router(): NextRouter | null {
        const next = page["next"] as { router?: NextRouter } | undefined;
        return next?.router ?? null;
    }

    /** The props of the route the router is showing now, when it holds them. */
    function currentProps(): unknown {
        const r = router();
        if (!r?.components) return null;
        const info = (r.route ? r.components[r.route] : undefined) ?? (r.pathname ? r.components[r.pathname] : undefined);
        return info?.props ?? null;
    }

    function publish(): void {
        const props = currentProps();
        if (!props) return;
        let text: string;
        try {
            text = JSON.stringify({ intel: "zillow-router-state", url: location.href, props });
        } catch {
            return; // a cycle, or something unserialisable: leave the old state
        }
        let element = document.getElementById(ELEMENT_ID);
        if (!element) {
            element = document.createElement("script");
            element.id = ELEMENT_ID;
            element.setAttribute("type", "application/json");
            (document.body ?? document.documentElement).append(element);
        }
        element.textContent = text;
    }

    /** Hooks the router's navigation events. Returns whether the router was there to hook. */
    function hook(): boolean {
        const r = router();
        if (!r?.events?.on) return false;
        // After the route change the router has the new props; publish on the
        // next tick so any late assignment has landed.
        r.events.on("routeChangeComplete", () => setTimeout(publish, 0));
        return true;
    }

    // The router appears once Next has hydrated, which may be after this
    // script runs; try for a while, then give up quietly.
    if (!hook()) {
        let attempts = 0;
        const timer = setInterval(() => {
            if (hook() || ++attempts > 40) clearInterval(timer);
        }, 250);
    }
    // A tab the source was enabled on after it had navigated in-page has a
    // stale __NEXT_DATA__ right now; the router does not.
    publish();
})();
