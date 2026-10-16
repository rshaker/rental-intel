import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { contentType, isPhotoPath, pagePath, photoPath, stripBase } from "./src/routes.js";
import { buildSite } from "./src/site.js";

/**
 * Serves the example site from memory in `vite` dev and writes it out in
 * `vite build`; `vite preview` answers from memory too. The pages are
 * rendered once per server start; Vite restarts the dev server when a file
 * this plugin imports changes.
 */
export function listingsExampleSite(): Plugin {
    const files = buildSite();
    const has = (path: string) => files.has(path);
    const serve = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
        const pathname = stripBase(new URL(req.url ?? "/", "http://localhost").pathname);
        if (pathname === null) return next();
        const target = isPhotoPath(pathname) ? { path: photoPath(pathname), status: 200 } : pagePath(pathname, has);
        const body = files.get(target.path);
        if (body === undefined) return next();
        res.statusCode = target.status;
        res.setHeader("Content-Type", contentType(target.path));
        res.end(body);
    };
    return {
        name: "listings-example-site",
        configureServer(server) {
            server.middlewares.use(serve);
        },
        configurePreviewServer(server) {
            // `appType: "custom"` leaves preview without index-file lookup; answer from memory like dev does.
            server.middlewares.use(serve);
        },
        generateBundle(_options, bundle) {
            // The stub entry chunk is not part of the site.
            for (const key of Object.keys(bundle)) delete bundle[key];
            for (const [fileName, source] of files) this.emitFile({ type: "asset", fileName, source });
        },
    };
}
