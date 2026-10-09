/**
 * Zillow's main-world script (`world: "MAIN"`), where the page's globals are
 * reachable. Zillow is a Next.js single-page app: `__NEXT_DATA__` describes
 * the page first loaded, and an in-page move to another listing leaves it
 * stale while the router holds the new props. After every route change this
 * copies the current route's props out of `window.next.router` into a
 * `<script id="__intel_zillow_state">` of its own, which the content script
 * reads first. A page without the router leaves no element and no error.
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
        // On the next tick, so a late assignment has landed.
        r.events.on("routeChangeComplete", () => setTimeout(publish, 0));
        return true;
    }

    // The router appears once Next has hydrated; try for a while.
    if (!hook()) {
        let attempts = 0;
        const timer = setInterval(() => {
            if (hook() || ++attempts > 40) clearInterval(timer);
        }, 250);
    }
    // A tab enabled late may already have a stale __NEXT_DATA__.
    publish();
})();
