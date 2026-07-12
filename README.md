# pi-lynx
[![npm version](https://img.shields.io/npm/v/pi-lynx.svg)](https://www.npmjs.com/package/pi-lynx)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-blue)](https://pi.dev/packages/pi-lynx)
[![Requires lynx](https://img.shields.io/badge/requires-lynx-orange)](#requirements)

Give Pi agents context-safe plain-text web search, GitHub/Wikipedia search, Reddit search/thread fetch, and page fetch with no API keys. Body text first; links are opt-in and capped.

[Capabilities](#capabilities) | [Install](#install) | [Quick start](#quick-start) | [Demo](#demo) | [Tools](#tools) | [Failure modes](#failure-modes)

> Early v1.x. Search uses public HTML search surfaces (DDG Lite/site-filtered search and optional Brave Search HTML) that may throttle, block, or change without notice. Requires `lynx` on `PATH`. JS-heavy pages are not supported.

## Capabilities

| Need | Tool |
| ---- | ---- |
| Current web search | `lynx_web_search` |
| Alternative web index | `lynx_brave_search` |
| GitHub search | `lynx_web_search_github` |
| Wikipedia/reference search | `lynx_web_search_wikipedia` |
| Reddit discussion search | `lynx_reddit_search` |
| Reddit post + top comments | `lynx_reddit_fetch` |
| Plain-text page fetch | `lynx_web_fetch` |

- Agent-readable Markdown/text by default; no raw API dumps.
- Capped outputs to avoid flooding context.
- No API keys or accounts for DDG Lite, Brave Search HTML, page fetch, old Reddit search, or Reddit thread JSON.

## Demo

![pi-lynx in action](https://raw.githubusercontent.com/dabito/pi-lynx/main/docs/demo/pi-lynx.png)

Animated terminal demo:

![pi-lynx terminal demo](https://raw.githubusercontent.com/dabito/pi-lynx/main/docs/demo/pi-lynx.gif)

Recorded terminal demo source: [`docs/demo/pi-lynx.cast`](https://github.com/dabito/pi-lynx/blob/main/docs/demo/pi-lynx.cast)

Play locally:

```bash
asciinema play docs/demo/pi-lynx.cast
```

The demo shows:

- `pi install npm:pi-lynx`
- `lynx` available on `PATH`
- Pi using `pi-lynx` for web search/page fetch
- bounded, body-text-first output
- links as opt-in context

## Install

```bash
pi install npm:pi-lynx
```

Then reload or restart pi:

```text
/reload
```

### Requirements

- [lynx](https://lynx.invisible-island.net/) installed and on `PATH`
- Pi coding agent

#### Installing lynx

| OS | Command |
| -- | ------- |
| macOS | `brew install lynx` |
| Debian/Ubuntu | `sudo apt install lynx` |
| Fedora/RHEL | `sudo dnf install lynx` |
| Arch | `sudo pacman -S lynx` |
| Windows | Use WSL (`wsl --install`), then `sudo apt install lynx` inside it. Native Windows lynx builds are unmaintained; pi-lynx shells out to a Unix `lynx` binary. |

Verify:

```bash
lynx -version
```
### Quick start

Search:

```text
lynx_web_search: rust language
```

Alternative index (when DDG throttles):

```text
lynx_brave_search: rust language
```

Reddit discussion search:

```text
lynx_reddit_search: pi coding agent
```

Subreddit-scoped Reddit search:

```text
lynx_reddit_search: extensions {"subreddit": "PiCodingAgent"}
```

Reddit thread fetch:

```text
lynx_reddit_fetch: https://www.reddit.com/r/PiCodingAgent/comments/...
```
Fetch page text only:

```text
lynx_web_fetch: https://example.com
```

Fetch with links:

```text
lynx_web_fetch: https://example.com {"include_links": true, "link_limit": 20}
```
### Search engine behavior

- `lynx_web_search` uses the configured search-engine chain (`PI_LYNX_SEARCH_ENGINES`, defaulting to DDG-style public HTML search).
- `lynx_brave_search` queries Brave Search HTML directly as an alternate no-key search surface.
- GitHub and Wikipedia helpers are site-filtered convenience wrappers over the default web-search path.
- These are best-effort HTML parsers, not search APIs; public search pages may throttle, block, or change markup.

### Alternative: install from git

```bash
pi install git:github.com/dabito/pi-lynx
```

### Alternative: install from source

```bash
git clone https://github.com/dabito/pi-lynx.git
cd pi-lynx
npm install
pi -e .
```

## Tools

### Tool composition

Tools are composed in a layered hierarchy to avoid duplication:

```text
lynx_web_fetch            ← base layer (lynx -dump + parse)
  ↑ used by
lynx_web_search           ← DDG Lite URL construction + result parsing
  ↑ used by
lynx_web_search_github    ← convenience wrapper (pre-set site:github.com)
lynx_web_search_wikipedia ← convenience wrapper (pre-set site:wikipedia.org)

lynx_brave_search         ← Brave Search (native fetch + HTML parse; alt index)
lynx_reddit_search        ← old.reddit.com search (lynx -dump + parse)
lynx_reddit_fetch         ← reddit thread .json API (native fetch)
```

Brave search fetches Brave's server-rendered HTML directly (with a browser User-Agent) and parses `data-type="web"` blocks — a different index than DDG, useful when DDG Lite throttles or returns poor results. It needs no API key.

Reddit search uses old.reddit.com first because Reddit's JSON search endpoint usually blocks bot-like traffic. Reddit thread fetch still uses the public `.json` thread endpoint because it returns cleaner post/comment data when available.

### `lynx_web_fetch`

Fetch a web page and extract its text content using lynx. Links are opt-in and capped by default.

| Name            | Type    | Required | Default | Description                                              |
| --------------- | ------- | -------- | ------- | -------------------------------------------------------- |
| `url`           | string  | ✓        | —       | URL to fetch                                             |
| `max_lines`     | number  |          | 300     | Max lines of body text (50–2000)                         |
| `include_links` | boolean |          | false   | Include extracted links section                           |
| `link_limit`    | number  |          | 20      | Max links when `include_links=true`                      |

### `lynx_web_search`

Search the web using DuckDuckGo Lite. Returns structured results with titles, snippets, domains, and URLs.

| Name          | Type   | Required | Default | Description                                     |
| ------------- | ------ | -------- | ------- | ----------------------------------------------- |
| `query`       | string | ✓        | —       | Search query; supports `!gh` and `!w` shortcuts |
| `max_results` | number |          | 8       | Max results to return (1–20)                    |
| `site`        | string |          | —       | Restrict to `"github"` or `"wikipedia"`       |
| `engine`      | string |          | `"ddg"` | `"ddg"`, `"brave"`, or `"auto"` (runs the `PI_LYNX_SEARCH_ENGINES` chain with fallback) |

Shortcuts:

- `!gh <query>` or `site: "github"` → restricts to GitHub
- `!w <query>` or `site: "wikipedia"` → restricts to Wikipedia

If both a bang shortcut and an explicit site filter are provided, the explicit filter wins. For example, `query: "!gh rust", site: "wikipedia"` searches Wikipedia for `rust`.

`engine` defaults to `"ddg"` so existing behavior is unchanged. Set `engine: "brave"` to search Brave directly, or `engine: "auto"` to run the ordered engine chain configured by `PI_LYNX_SEARCH_ENGINES`, falling back to the next engine on error or (by default) on an empty result set.

### `lynx_web_search_github`

Search GitHub using DuckDuckGo Lite. Convenience wrapper around `lynx_web_search` with `site:github.com` pre-set.

| Name          | Type   | Required | Default | Description          |
| ------------- | ------ | -------- | ------- | -------------------- |
| `query`       | string | ✓        | —       | Search query         |
| `max_results` | number |          | 8       | Max results to return |

### `lynx_web_search_wikipedia`

Search Wikipedia using DuckDuckGo Lite. Convenience wrapper around `lynx_web_search` with `site:wikipedia.org` pre-set.

| Name          | Type   | Required | Default | Description          |
| ------------- | ------ | -------- | ------- | -------------------- |
| `query`       | string | ✓        | —       | Search query         |
| `max_results` | number |          | 8       | Max results to return |
| `max_results` | number |          | 8       | Max results to return |

### `lynx_brave_search`

Search the web via [Brave Search](https://search.brave.com) and return structured results: titles, snippets, domains, and URLs. No API key required. Use as an alternative to `lynx_web_search` when DDG Lite throttles or returns poor results — it is a different index and ranking.

| Name          | Type   | Required | Default | Description                         |
| ------------- | ------ | -------- | ------- | ----------------------------------- |
| `query`       | string | ✓        | —       | Search query                        |
| `max_results` | number |          | 8       | Max results to return (1–20)        |
### `lynx_reddit_fetch`

Fetch a Reddit thread and return compact agent-readable text: post title/body plus top comments sorted by score. Uses Reddit's public `.json` endpoint internally; no `lynx` or API key required.

| Name            | Type   | Required | Default | Description                                  |
| --------------- | ------ | -------- | ------- | --------------------------------------------- |
| `url`           | string | ✓        | —       | Reddit thread/comments URL                    |
| `max_comments`  | number |          | 10      | Max top-level comments to include (1–50), sorted by score |

### `lynx_reddit_search`

Search Reddit threads via old.reddit.com and return compact agent-readable results: titles, subreddits, authors, scores, comment counts, and permalinks. No API key required.

| Name          | Type   | Required | Default | Description                                  |
| ------------- | ------ | -------- | ------- | --------------------------------------------- |
| `query`       | string | ✓        | —       | Search query                                  |
| `subreddit`   | string |          | —       | Restrict search to this subreddit (no `r/` prefix) |
| `max_results` | number |          | 10      | Max results to return (1–25)                  |

## Behavior notes

- `lynx_web_fetch` returns body text only by default.
- Links are explicit opt-in: set `include_links: true`.
- When links are included, they are capped by `link_limit`.
- `max_lines` caps body text only.
- DDG Lite site-filtered searches may throttle; `PI_LYNX_SITE_SEARCH_INTERVAL_MS` spaces them out. If DDG still throttles, try `lynx_brave_search` (different index).
- `lynx_web_search` defaults to DDG-only (`engine: "ddg"`); pass `engine: "auto"` to run the `PI_LYNX_SEARCH_ENGINES` chain with fallback on error or empty results.
- `lynx_brave_search` uses native fetch (not lynx) against Brave's server-rendered HTML; it does not need `lynx` on `PATH`.
- `lynx_reddit_search` uses old.reddit.com and returns compact Markdown/text, not raw HTML.
- `lynx_reddit_search` uses old.reddit.com and returns compact Markdown/text, not raw HTML.

## Failure modes

- Missing `lynx`: install it and ensure it is on `PATH`.
- Site-filtered search throttled: wait, raise `PI_LYNX_SITE_SEARCH_INTERVAL_MS`, or switch to `lynx_brave_search`.
- Brave bot check: `lynx_brave_search` may receive no organic results from data-center IPs; retry later or from a different network.
- JS-heavy / browser-required pages: Lynx may not capture the interactive content.
- Reddit bot check: `lynx_reddit_search` uses old.reddit.com because Reddit JSON search is often blocked. `lynx_reddit_fetch` still uses Reddit's `.json` thread endpoint and can receive an HTML bot-check page instead of JSON; there is no bypass, so retry later or from a different network.

## Configuration catalog

| Variable | Default | Min | Description |
| -------- | ------- | --- | ----------- |
| `PI_LYNX_SITE_SEARCH_INTERVAL_MS` | `3000` | `1000` | Minimum spacing between DDG Lite `site:` searches. Use `4000` or higher if DuckDuckGo throttles repeated GitHub/Wikipedia searches. |
| `PI_LYNX_SEARCH_ENGINES` | `ddg` | — | Comma list of engines for `lynx_web_search`'s `engine: "auto"` chain, e.g. `ddg,brave`. Unknown/empty values fall back to `ddg`. Only takes effect when `engine: "auto"` is passed. |
| `PI_LYNX_SEARCH_FALLBACK_ON_EMPTY` | `true` | — | When `true` (default), an engine that returns zero results and no instant answer is skipped in favor of the next engine in the chain. Set to `0`/`false`/`no`/`off` to disable. |

## Command catalog

| Command | Purpose |
| ------- | ------- |
| `npm test` | Run fixture-based unit tests. Live DDG search stays skipped by default. |
| `PI_LYNX_INTEGRATION=1 npm test` | Run live DDG Lite integration tests. May throttle repeated `site:` searches. |
| `npm run typecheck` | Run strict TypeScript checking. |
| `npm run lint` | Run ESLint. |
| `npm pack --dry-run` | Preview publish tarball contents. |

## Notes on DuckDuckGo Lite

Raw DDG bangs such as `!gh` and `!w` redirect away from DDG Lite, so pi-lynx converts them to `site:` filters before searching.

DuckDuckGo Lite can temporarily rate-limit repeated `site:` searches. pi-lynx spaces site-filtered searches by at least 3 seconds by default; tune with `PI_LYNX_SITE_SEARCH_INTERVAL_MS`.

## How it works

1. `lynx_web_fetch` runs `lynx -dump` on a URL to get plain text.
2. The `References` section is parsed to build a `[N] → URL` mapping.
3. DDG redirect URLs (`duckduckgo.com/l/?uddg=...`) are resolved to real target URLs.
4. `[N]` markers are stripped from body text for clean output.
5. `lynx_web_search` constructs a DDG Lite URL and parses search results.
6. Site-specific tools call `lynx_web_search` with the appropriate `site:` filter.
7. `lynx_reddit_search` runs `lynx -dump` on old.reddit.com search and parses compact result metadata.
8. `lynx_reddit_fetch` calls Reddit's `.json` thread endpoint, parses the payload, and returns compact Markdown/text.

## Development

```bash
npm test
npm run typecheck
```

Unit tests use committed DuckDuckGo Lite fixtures in `test/fixtures`.

The live DDG Lite integration test is opt-in because repeated `site:` searches can be rate-limited:

```bash
PI_LYNX_INTEGRATION=1 npm test
```

## Related packages

- `hledit` for stable, hash-anchored file editing.
- `pi-hledit` for Pi integration with `hledit`.
