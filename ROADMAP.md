# Roadmap

## Brave Search provider

Add `lynx_brave_search` (or a `site`/engine option on `lynx_web_search`) backed by [Brave Search](https://search.brave.com), as an alternative to DuckDuckGo Lite — no API key needed for the plain web UI, and it's a different index/ranking than DDG worth having as an option.

Findings so far (2026-07-03):

- Reachable and server-side rendered: `https://search.brave.com/search?q=<query>&source=web` returns 200 with real content in the initial HTML (it's a SvelteKit app, but organic results are present server-side, not just client-hydrated) — confirmed via both raw `curl` and `lynx -dump`.
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
- Query-dependent layout: some queries (e.g. sports scores, "world cup") return a rich answer widget (live scores/standings) instead of, or ahead of, a plain organic result list — a parser needs to either skip these widgets gracefully or explicitly not promise structured output for them.
- Not yet tested: rate-limiting/blocking behavior under repeated automated queries (unlike the DDG Lite `site:` throttling pi-lynx already handles), and whether Brave's bot defenses tolerate sustained non-browser traffic over time.

Next step: decide whether to go through `lynx -dump` (reuse existing tool-composition pattern, accept the messier text parsing) or native `fetch` + light HTML parsing (cleaner given the known `result-wrapper`/`data-type="web"` hooks, but breaks the "everything goes through lynx" consistency pi-lynx otherwise has) — then capture a couple of real result pages as fixtures and implement whichever parser.


## Reddit search provider

Add `lynx_reddit_search` backed by old Reddit search (`https://old.reddit.com/search?q=<query>&sort=<sort>&t=<time>`) or Reddit JSON (`https://www.reddit.com/search.json?q=<query>`), as a direct Reddit source that avoids DDG `site:reddit.com` throttling.

Findings so far (2026-07-03):

- `old.reddit.com/search` is lynx-readable and returns useful server-rendered results without JavaScript.
- Old Reddit supports search operators (`subreddit:`, `author:`, `site:`, `url:`, `selftext:`, `self:yes/no`, `nsfw:yes/no`) and sort/time controls.
- Subreddit-scoped search can map to `/r/<subreddit>/search?q=<query>&restrict_sr=on`.
- Reddit JSON endpoints are cleaner for structured output when available, but may hit bot checks; old Reddit remains useful as a text-first fallback.

Next step: choose JSON-first with old.reddit fallback, capture fixtures for search + thread fetch, and document Reddit anti-bot failure modes clearly.
