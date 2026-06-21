# pi-lynx

A lean Pi extension that provides web search and page fetches using your local `lynx` browser and DuckDuckGo Lite. No API keys, no browser automation.

## Requirements

- [lynx](https://lynx.invisible-island.net/) installed and on `PATH`
- No API keys needed — uses DuckDuckGo's public Lite interface


Clone and install development dependencies if you want to run tests:

```bash
git clone https://github.com/dabito/pi-lynx.git
cd pi-lynx
npm install
```
## Install

### Option 1: Global extension

```bash
mkdir -p ~/.pi/agent/extensions/pi-lynx
ln -s /path/to/pi-lynx/index.ts ~/.pi/agent/extensions/pi-lynx/index.ts
```

### Option 2: Project-local extension

```bash
mkdir -p .pi/extensions/pi-lynx
ln -s /path/to/pi-lynx/index.ts .pi/extensions/pi-lynx/index.ts
```

### Option 3: Quick test

```bash
pi -e /path/to/pi-lynx/index.ts
```

### Option 4: Via settings.json

```json
{
  "extensions": ["/path/to/pi-lynx"]
}
```

## Tools

### Tool Composition

Tools are composed in a layered hierarchy to avoid duplication:

```
lynx_web_fetch           ← base layer (lynx -dump + parse)
  ↑ used by
lynx_web_search          ← DDG Lite URL construction + result parsing
  ↑ used by
lynx_web_search_github   ← convenience wrapper (pre-set site:github.com)
lynx_web_search_wikipedia ← convenience wrapper (pre-set site:wikipedia.org)
```

### `lynx_web_fetch`

Fetch a web page and extract its text content and links using lynx. This is the **base tool** — all search tools use it internally.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `url` | string | ✓ | — | URL to fetch |
| `max_lines` | number | | 300 | Max lines of body text (50–2000, excludes Links section) |
| `include_links` | boolean | | true | Include extracted links section |

### `lynx_web_search`

Search the web using DuckDuckGo Lite. Returns structured results with titles, snippets, and source domains.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | ✓ | — | Search query (supports `!gh` and `!w` shortcuts) |
| `max_results` | number | | 8 | Max results to return (1–20) |
| `site` | string | | — | Restrict to `"github"` or `"wikipedia"` (adds `site:` operator) |

**Shortcuts:**

- `!gh <query>` or `site: "github"` → restricts to GitHub

DuckDuckGo Lite can temporarily rate-limit repeated `site:` searches. If GitHub/Wikipedia searches suddenly return a DDG error page during testing, wait a bit and retry.
- `!w <query>` or `site: "wikipedia"` → restricts to Wikipedia

### `lynx_web_search_github`

Search GitHub using DuckDuckGo Lite. Convenience wrapper around `lynx_web_search` with `site:github.com` pre-set.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | ✓ | — | Search query |
| `max_results` | number | | 8 | Max results to return (1–20) |

### `lynx_web_search_wikipedia`

Search Wikipedia using DuckDuckGo Lite. Convenience wrapper around `lynx_web_search` with `site:wikipedia.org` pre-set.

**Parameters:**

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `query` | string | ✓ | — | Search query |
| `max_results` | number | | 8 | Max results to return (1–20) |

## How it works

1. `lynx_web_fetch` runs `lynx -dump` on a URL to get plain text + link references
2. The `References` section is parsed to build a `[N] → URL` mapping
3. DDG redirect URLs (`duckduckgo.com/l/?uddg=...`) are resolved to real target URLs
4. `[N]` markers are stripped from body text for clean output
5. `lynx_web_search` constructs a DDG Lite URL, uses `lynx_web_fetch` internally, then parses search results
6. `!gh`/`!w` shortcuts are converted to `site:` filters (raw `!` bangs redirect away from DDG Lite and break parsing)
7. Site-specific tools (`_github`, `_wikipedia`) call `lynx_web_search` with the appropriate `site:` filter


## Development

```bash
npm test
npm run build
```

Unit tests use captured DuckDuckGo Lite fixtures. The live DDG Lite integration test is opt-in because repeated `site:` searches can be rate-limited:

```bash
PI_LYNX_INTEGRATION=1 npm test
```
No browser automation, no headless Chrome, no API keys — just lynx + DDG Lite.
