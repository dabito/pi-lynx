# Changelog

## [1.0.5] - 2026-06-29

### Changed

- Split implementation into `core.ts`, `runtime.ts`, and `index.ts`.
- Made `lynx_web_fetch` context-safe by default: links opt-in, capped by `link_limit`.
- Added README quick start, behavior notes, failure modes, and related packages.
- Added tool-contract tests for registered tool names and fetch defaults.
- Added `bugs` and `homepage` metadata.

## [1.0.4] - 2026-06-28

### Fixed

- Removed duplicate search parser definitions that broke TypeScript builds.
- Kept `!gh`/`!w` shortcuts while making explicit `site` filters take precedence.
- Moved `typebox` to runtime dependencies for package installs.
- Passed cancellation signals through `lynx` execution.

### Added

- Serialized pacing for repeated DDG Lite `site:` searches.
- `PI_LYNX_SITE_SEARCH_INTERVAL_MS` env override for site-search pacing.
- README configuration and command catalog.
- `npm run lint` script.

## [1.0.0] - 2026-06-20

### Added

- `lynx_web_fetch` — base tool for fetching and extracting text + links from any URL via lynx
- `lynx_web_search` — search the web via DuckDuckGo Lite with `!gh`/`!w` shortcuts and `site:` filter
- `lynx_web_search_github` — convenience wrapper for GitHub search
- `lynx_web_search_wikipedia` — convenience wrapper for Wikipedia search
- Tool composition hierarchy: fetch → search → site-specific wrappers
- 28 unit tests + integration tests with mock DDG Lite data
- README with install instructions and tool documentation
