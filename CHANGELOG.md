# Changelog

## [1.0.0] - 2026-06-20

### Added

- `lynx_web_fetch` — base tool for fetching and extracting text + links from any URL via lynx
- `lynx_web_search` — search the web via DuckDuckGo Lite with `!gh`/`!w` shortcuts and `site:` filter
- `lynx_web_search_github` — convenience wrapper for GitHub search
- `lynx_web_search_wikipedia` — convenience wrapper for Wikipedia search
- Tool composition hierarchy: fetch → search → site-specific wrappers
- 28 unit tests + integration tests with mock DDG Lite data
- README with install instructions and tool documentation
