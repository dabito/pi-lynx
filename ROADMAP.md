# Roadmap

> **Positioning.** pi-lynx is keyless, scraping-first web access. Its
> differentiator vs API-key extensions (e.g. `pi-web-access`, which wraps
> OpenAI/Brave/Tavily/Exa/Perplexity/Gemini) is **zero config, no keys, no
> paid egress**. The strategic lesson from that category worth stealing
> without abandoning our identity: **"something always works" via
> multi-source fallback chains.** Everything below serves that goal.

## Next stopping point

**Improve result quality with DDG sponsored/ad filtering.** Smallest high-confidence
quality win after the 1.1.5 search-chain release. Scope of the stop:

1. Add a DDG fixture containing sponsored results (`duckduckgo.com/y.js`,
   "Sponsored link", or equivalent ad markers).
2. Teach the DDG parser to skip sponsored/ad blocks before result limiting.
3. Preserve organic DDG parsing, instant answers, and site-filter behavior.
4. Add regression tests for sponsored filtering and normal organic results.
5. Patch release.

Next larger stop after that: **fetch hardening via Jina Reader fallback** for
JS-heavy pages where `lynx -dump` returns thin or empty content.

---

## Recently shipped

- **1.1.5:** `lynx_web_search` gained an `engine` selector (`"ddg"`,
  `"brave"`, `"auto"`) plus a configurable DDG/Brave adapter chain via
  `PI_LYNX_SEARCH_ENGINES` and `PI_LYNX_SEARCH_FALLBACK_ON_EMPTY`.
- **1.1.4:** `lynx_brave_search` shipped as a direct Brave Search HTML tool
  using native fetch + server-rendered organic result parsing.
- **1.1.1:** `lynx_reddit_search` switched to old.reddit.com as primary search.

---

## Search: multi-engine + fallback chain

Goal: one logical `lynx_web_search` that tries sources in order so a single
provider's throttle/block does not dead-end the agent. DDG + Brave are live;
next search work should improve quality and add optional engines.

- **DDG + Brave chain** — shipped in 1.1.5. Default remains DDG-only for
  backward compatibility; `engine="auto"` opts into the configured chain.
- **SearXNG** — public instances (or self-hosted) need no key; lynx-readable
  HTML; candidate 3rd leg of the chain. Needs instance health/timeout policy.
- **Startpage** — Google results proxy, keyless; lower priority because
  anti-bot pressure is heavier.
- **Fallback orchestration** — already handles ordered attempts, errors, and
  empty outcomes. Remaining work: better throttle detection, per-engine retry
  hints, and richer attempt metadata without bloating agent text.
- **Engine adapters** — keep internal and backward-compatible. Keep
  `lynx_brave_search` as explicit Brave-only alias even though
  `lynx_web_search` can use Brave.

### Brave Search — status notes

- Shipped as native fetch + raw HTML parser, not lynx, because lynx flattened
  title/snippet boundaries ambiguously.
- Organic result parser uses Brave server-rendered `data-type="web"` blocks.
- Brave can still return 429 or unparseable bot-check/challenge pages; tool
  fails loud with retry guidance. This is best-effort public HTML parsing, not
  an official API.
- Site filters are appended as `site:domain` in the query. Bang shortcuts
  (`!gh`, `!w`) and explicit site precedence are normalized before Brave URL
  generation.
---

## Fetch hardening

Goal: `lynx_web_fetch` should not dead-end on JS-heavy or non-HTML content.

- **Jina Reader fallback** — `r.jina.ai/<url>` returns clean markdown, keyless free tier. Chain: lynx returns thin/empty body → retry via Jina. Biggest single fix for our "JS-heavy pages unsupported" failure mode.
- **Readability / main-content extraction** — strip nav/chrome/boilerplate from lynx dumps; keep the "body-text-first" promise sharper. May subsume part of what Jina gives us.
- **PDF → text** — shell out to `pdftotext` (poppler) if present on PATH, same optional-binary pattern as `lynx`. Extends fetch to docs/PDFs keylessly.
- **Fallback orchestration** — mirror the search chain: lynx → Jina, with clear per-step failure messages.

---

## Result quality

- **Sponsored/ad filtering** — strip DDG Lite sponsored results (`duckduckgo.com/y.js`, "Sponsored link"). Known issue observed during World Cup smoke. Low effort, quality win.
- **TTL result cache** — short in-process (or on-disk) cache for repeat searches + fetches; cuts redundant network and re-parse. Mind the context-safety guarantees; cache raw parse output, not agent text.
- **Freshness** — surface result dates where the source exposes them (Brave shows "1 week ago"; old.reddit has timestamps).

---

## Reddit: old.reddit search primary; thread fetch fallback

Current behavior:

- `lynx_reddit_search` uses old.reddit.com as the primary path because Reddit JSON search frequently returns 403/bot-check responses.
- `lynx_reddit_fetch` still uses Reddit's `.json` thread endpoint because it returns cleaner post/comment data when available.

Remaining Reddit follow-up:

- Add an old.reddit thread fallback for `lynx_reddit_fetch` if Reddit's `.json` thread endpoint becomes unreliable.
- Consider exposing old Reddit search controls (`sort=hot|top|new|comments`, `t=hour|day|week|month|year|all`) after real usage proves the defaults insufficient.
- Keep output compact Markdown/text; do not expose raw Reddit JSON or raw old.reddit HTML by default.

---

## Out of scope (stays keyless/scraping-bound)

Deliberately **not** pursued, to protect the zero-config identity — but noted so
the decision is explicit:

- **Video understanding** (YouTube transcripts, local video analysis) — needs an API or a vision model. Off-brand.
- **Paid/API-key search providers** (Tavily, Exa, Perplexity, Serper, Google CSE) — defeats the differentiator. Could later surface as an optional `engine` opt-in, but never as the default path.
- **Headless browser / JS execution** (Playwright/Puppeteer) — heavy dependency, anti-text-browser. Jina Reader fallback covers the realistic JS-page need at far lower cost.
