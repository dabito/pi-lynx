# Changelog

## [1.1.4] - 2026-07-08

### Added

- `lynx_brave_search` — web search via [Brave Search](https://search.brave.com), an alternative index to DDG Lite. Parses Brave's server-rendered HTML directly (native fetch + browser User-Agent, no lynx, no API key). Foundation for a future DDG→Brave fallback chain.

### Changed

- README: capabilities matrix, tool composition diagram, quick-start example, and behavior/failure notes now cover Brave search.

## [1.1.3] - 2026-07-08

### Changed

- Switched `pi.dev` gallery preview from the 1.5MB demo GIF to a lighter PNG screenshot.
- README demo section now leads with the static screenshot, keeping the animated GIF below it.

## [1.1.2] - 2026-07-08

### Added

- Gallery preview image for [pi.dev/packages](https://pi.dev/packages) listing via `pi.image` pointing at the demo GIF.

## [1.1.1] - 2026-07-04

### Fixed

- Switched `lynx_reddit_search` from Reddit JSON search to old.reddit.com via `lynx -dump`; Reddit JSON search frequently returns 403/bot-check responses.
- Added old.reddit search parser coverage and fixture.
- Used `pi-tui` `truncateToWidth` for widget rendering so ANSI, tabs, emoji, and CJK text truncate by display width.

## [1.1.0] - 2026-07-03

### Added

- `lynx_reddit_fetch` — fetch a reddit thread (post + top comments) via reddit's public `.json` API, no lynx or API key needed.
- `lynx_reddit_search` — search reddit via its `.json` API, optionally scoped to a subreddit.
- Reddit tools use native `fetch` instead of `lynx -dump`: reddit blocks lynx's scraping and the page is JS-rendered, but the `.json` API is a plain structured-data endpoint.
- Documented the reddit bot-check failure mode: reddit can return an HTML challenge page instead of JSON, especially from data-center IPs; the tools fail loud with no bypass.
- Added README capabilities matrix, Reddit quick starts, and npm discovery keywords for Reddit/GitHub/Wikipedia search.
- Documented Reddit `.json` as internal transport while keeping agent output compact Markdown/text.

## [1.0.6] - 2026-06-30

### Changed

- Added asciinema demo (GIF + cast) to README.
- Reworked README intro and nav for marketing.

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
