Older maps with `config-features.js`, `config-text.json` and a country CSV are loaded into the editor's current configuration model. On their first update, `buildMigrationTree` writes the current Svelte 5 / SvelteKit 2 renderer and its locked dependencies in one commit, converts all existing language files and adds the new values. A subsequent update follows the normal current-format path.

The migration keeps the repository, branch, hosting marker, domains, original IFRAME.md and country assets. The standalone root route supports old embeds without `view=fullscreen`, URL language selection and the existing `{height}` postMessage protocol. It shares MapPanel, MapChoropleth and supporting renderer files with the editor; public bundles contain no editor API routes.

Old entry points and competing build configurations are removed. Previous generator scripts and workflow definitions are copied to `.map-tool-legacy`; the generator scripts become no-ops, so old manual workflow runs cannot overwrite the migrated languages. Workflow definitions themselves remain untouched to avoid requiring additional GitHub workflow permissions.

`map-runtime-files.json` pins the public build configuration and dependency lock from map-tool-update main at da18e865495e2e7df2db1f033a4335ef86f6a25d. Renderer and store sources are bundled directly by Vite at build time. When changing package dependencies, refresh the package and lock entries together and run the migration tests and a standalone production build.

Tests: `node --test tests/legacy-map-repositories.test.mjs tests/migrate-legacy-map.test.mjs`.
