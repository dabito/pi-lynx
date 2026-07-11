# Roadmap

> **Positioning.** pi-lynx is keyless, scraping-first web access. Its
> differentiator vs API-key extensions (e.g. `pi-web-access`, which wraps
> OpenAI/Brave/Tavily/Exa/Perplexity/Gemini) is **zero config, no keys, no
> paid egress**. The strategic lesson from that category worth stealing
> without abandoning our identity: **"something always works" via
> multi-source fallback chains.** Everything below serves that goal.

## Next stopping point

**Ship `lynx_brave_search`.** It is the foundation for the multi-engine
fallback chain (DDG throttled → Brave → …) and the highest-value unshipped
item. Scope of the stop:

1. Capture 2 real Brave result fixtures (general + one site-scoped) into `test/fixtures/`.
2. Implement `buildBraveSearchUrl()` + `parseBraveResults()` in `core.ts` (heuristic parser — see research notes below).
3. Register `lynx_brave_search` mirroring `lynx_web_search` (same params/`details`/render hooks).
4. Parser + URL-builder tests; smoke a real query.
5. Patch release.

Follow-on (separate stop, after Brave lands): wire `lynx_web_search` to fall
back DDG → Brave when DDG returns a throttle/empty result, behind
`PI_LYNX_SEARCH_FALLBACK=1` (default on).

---

## Search: multi-engine + fallback chain

Goal: one logical `lynx_web_search` that tries sources in order so a single
provider's throttle/block never dead-ends the agent.

- **Brave Search** — researched, unimplemented. See findings below. Keyless via the plain web UI.
- **SearXNG** — public instances (or self-hosted) need no key; lynx-readable HTML; candidate 3rd leg of the chain.
- **Startpage** — Google results proxy, keyless; lower priority (heavier anti-bot).
- **Fallback orchestration** — order + per-source throttle detection + short-circuit on first good result. Reuse the existing `PI_LYNX_SITE_SEARCH_INTERVAL_MS` pacing pattern.
- Keep `lynx_web_search` as the stable agent-facing name; engines are an internal concern unless an explicit `engine` param proves useful later.

### Brave Search — research notes (2026-07-03)

- Reachable and server-side rendered: `https://search.brave.com/search?q=<query>&source=web` returns 200 with real content in the initial HTML (SvelteKit app, but organic results are present server-side, not just client-hydrated) — confirmed via both raw `curl` and `lynx -dump`.
- Structural hooks exist in the raw HTML for a future non-lynx (native fetch + DOM-ish regex) parser if that's ever preferable: `<div class="result-wrapper ...">` / `<div class="result-content ...">`, `data-type="web"` on organic results.
- `lynx -dump` output is usable but messier than DDG Lite's: heavy nav/button chrome at the top, favicon alt-text noise (renders as `U1F310` emoji codepoints), and result blocks aren't cleanly numbered like DDG Lite's `1.  Title` — a result looks like:
  ```text
     [13]
     U1F310
     Wikipedia
     en.wikipedia.org > wiki > Rust_(programming_language)
     Rust (programming language) - Wikipedia
     1 week ago - Rust is a general-purpose programming language which
     emphasizes performance, type safety, concurrency, and memory safety.
     ...
  ```
  i.e. site name, then a breadcrumb-style URL path (`domain > segment > segment`), then title, then snippet — needs a heuristic parser (skip the nav/chrome preamble, detect result blocks by the breadcrumb-URL line shape) rather than a simple numbered-line split like `parseResultBlocks` uses for DDG Lite.
- Query-dependent layout: some queries (e.g. sports scores, "world cup") return a rich answer widget (live scores/standings) instead of, or ahead of, a plain organic result list — a parser must skip these widgets gracefully or explicitly decline structured output for them.
- Open question: rate-limiting/blocking under sustained automated queries — test whether Brave's bot defenses tolerate non-browser traffic over time (unlike the DDG Lite `site:` throttling we already handle).

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
