// TypeDoc configuration for the documentation site (`npm run docs`). Paths are
// relative to the repo root, like the other *.config.* files here.

/** @type {Partial<import("typedoc").TypeDocOptions>} */
export default {
    name: "Rental Intel",
    tsconfig: "tsconfig.json",

    // One page per module, mirroring the src/ tree. The entry scripts (service
    // worker, content scripts, pages) export nothing, so their pages would be
    // empty.
    entryPoints: ["src"],
    entryPointStrategy: "expand",
    exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "src/background.ts",
        "src/sources/*/*.content.ts",
        "src/panel/main.tsx",
        "src/viewer/main.ts",
        "src/options/main.ts",
    ],

    // The README is the landing page. Every hand-written page in docs/ becomes
    // a "Documents" entry (privacy policy, ...). A relative link in either to
    // a file TypeDoc does not know about is copied into the site verbatim.
    readme: "README.md",
    projectDocuments: ["docs/*.md"],

    out: "docs/dist",
    cleanOutputDir: true,
    hostedBaseUrl: "https://rshaker.github.io/rental-intel/",
    includeVersion: true,
    excludeExternals: true,
    excludePrivate: true,
    excludeInternal: true,
    navigation: {
        includeCategories: false,
        includeGroups: false,
        includeFolders: true,
    },
    validation: {
        notExported: false,
        invalidLink: true,
        notDocumented: false,
    },
    treatWarningsAsErrors: false,
};
