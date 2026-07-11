/**
 * pi-lynx tests
 *
 * Two layers:
 * 1. Unit tests — pure functions with mock data (no network)
 * 2. Integration tests — actually calls lynx against DDG Lite (requires lynx on PATH)
 *
 * Run: npx tsx index.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import {
	parseLinks,
	resolveDdgRedirect,
	stripLinkMarkers,
	buildDdgLiteUrl,
	parseSearchResults,
	parseBraveResults,
	formatSearchResults,
	normalizeSearchQuery,
	getSiteSearchMinIntervalMs,
	parseRedditThread,
	parseRedditSearch,
	parseOldRedditSearch,
	formatRedditThread,
	formatRedditSearchResults,
} from "./index.ts";
import {
	buildRedditThreadJsonUrl,
	buildRedditSearchJsonUrl,
	buildBraveSearchUrl,
	buildOldRedditSearchUrl,
} from "./core.ts";

// ── Fixtures ──────────────────────────────────────────────────────────

const fixture = (name: string) =>
	fileURLToPath(new URL(`./test/fixtures/${name}`, import.meta.url));

const DDG_RUST_RAW = readFileSync(fixture("ddg-rust.txt"), "utf8");
const DDG_GITHUB_RAW = readFileSync(fixture("ddg-github.txt"), "utf8");
const REDDIT_THREAD_JSON = JSON.parse(readFileSync(fixture("reddit-thread.json"), "utf8"));
const REDDIT_SEARCH_JSON = JSON.parse(readFileSync(fixture("reddit-search.json"), "utf8"));
const OLD_REDDIT_SEARCH_RAW = readFileSync(fixture("old-reddit-search.txt"), "utf8");
const BRAVE_SEARCH_HTML = readFileSync(fixture("brave-search.html"), "utf8");

// ── Unit tests: parseLinks ────────────────────────────────────────────

describe("parseLinks", () => {
	it("extracts numbered links from DDG Lite References section", () => {
		const links = parseLinks(DDG_RUST_RAW);
		assert.ok(links.size > 0, "should find links");
		// First link is the opensearch XML
		assert.equal(links.get(1), "https://duckduckgo.com/opensearch_lite_v2.xml");
		// Should have DDG redirect URLs
		const redirectLink = links.get(4);
		assert.ok(redirectLink?.startsWith("https://duckduckgo.com/l/?uddg="));
	});

	it("extracts links from GitHub site-filtered results", () => {
		const links = parseLinks(DDG_GITHUB_RAW);
		assert.ok(links.size > 0, "should find links in github results");
	});

	it("returns empty map when no References section", () => {
		const links = parseLinks("just some text\nwith no references\n");
		assert.equal(links.size, 0);
	});

	it("handles Visible links header", () => {
		const raw =
			"Some text\n\nVisible links:\n   1. https://example.com\n   2. https://other.com\n";
		const links = parseLinks(raw);
		assert.equal(links.size, 2);
		assert.equal(links.get(1), "https://example.com");
		assert.equal(links.get(2), "https://other.com");
	});

	it("handles Hidden links header", () => {
		const raw = "Some text\n\nHidden links:\n   1. https://hidden.com\n";
		const links = parseLinks(raw);
		assert.equal(links.size, 1);
		assert.equal(links.get(1), "https://hidden.com");
	});
});

// ── Unit tests: resolveDdgRedirect ────────────────────────────────────

describe("resolveDdgRedirect", () => {
	it("resolves DDG redirect URLs to real targets", () => {
		const redirect =
			"https://duckduckgo.com/l/?uddg=https%3A%2F%2Frust-lang.org%2F&rut=abc123";
		assert.equal(resolveDdgRedirect(redirect), "https://rust-lang.org/");
	});

	it("returns non-DDG URLs unchanged", () => {
		assert.equal(
			resolveDdgRedirect("https://example.com"),
			"https://example.com",
		);
	});

	it("returns invalid URLs unchanged", () => {
		assert.equal(resolveDdgRedirect("not-a-url"), "not-a-url");
	});

	it("handles DDG redirect with path", () => {
		const redirect =
			"https://duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Frust-lang%2Frust&rut=abc";
		assert.equal(
			resolveDdgRedirect(redirect),
			"https://github.com/rust-lang/rust",
		);
	});
});

// ── Unit tests: stripLinkMarkers ──────────────────────────────────────

describe("stripLinkMarkers", () => {
	it("removes [N] markers from text", () => {
		assert.equal(
			stripLinkMarkers("Rust [4]Programming Language"),
			"Rust Programming Language",
		);
	});

	it("removes multiple markers", () => {
		assert.equal(stripLinkMarkers("[1]Hello [2]World [3]"), "Hello World ");
	});

	it("returns text without markers unchanged", () => {
		assert.equal(stripLinkMarkers("clean text"), "clean text");
	});
});

// ── Unit tests: buildDdgLiteUrl ───────────────────────────────────────

describe("buildDdgLiteUrl", () => {
	it("builds basic DDG Lite URL", () => {
		const url = buildDdgLiteUrl("rust language");
		assert.equal(url, "https://lite.duckduckgo.com/lite/?q=rust%20language");
	});

	it("builds URL with site filter", () => {
		const url = buildDdgLiteUrl("pi extension", "site:github.com");
		assert.equal(
			url,
			"https://lite.duckduckgo.com/lite/?q=pi%20extension%20site%3Agithub.com",
		);
	});

	it("trims whitespace from query", () => {
		const url = buildDdgLiteUrl("  rust  ");
		assert.equal(url, "https://lite.duckduckgo.com/lite/?q=rust");
	});

	it("handles special characters", () => {
		const url = buildDdgLiteUrl("c++ programming");
		assert.ok(url.includes("c%2B%2B"));
	});
});

// ── Unit tests: normalizeSearchQuery ──────────────────────────────────

describe("normalizeSearchQuery", () => {
	it("converts !gh bang to a GitHub site filter", () => {
		assert.deepEqual(normalizeSearchQuery("!gh pi extension"), {
			cleanQuery: "pi extension",
			effectiveFilter: "site:github.com",
		});
	});

	it("converts !w bang to a Wikipedia site filter", () => {
		assert.deepEqual(normalizeSearchQuery("!w rust language"), {
			cleanQuery: "rust language",
			effectiveFilter: "site:wikipedia.org",
		});
	});

	it("lets an explicit site filter take precedence over a bang", () => {
		assert.deepEqual(
			normalizeSearchQuery("!gh rust language", "site:wikipedia.org"),
			{
				cleanQuery: "rust language",
				effectiveFilter: "site:wikipedia.org",
			},
		);
	});

// ── Unit tests: getSiteSearchMinIntervalMs ──────────────────────────────

describe("getSiteSearchMinIntervalMs", () => {
	it("uses the default interval when unset", () => {
		assert.equal(getSiteSearchMinIntervalMs(undefined), 3000);
	});

	it("clamps too-small values to the minimum", () => {
		assert.equal(getSiteSearchMinIntervalMs("250"), 1000);
	});

	it("uses valid custom intervals", () => {
		assert.equal(getSiteSearchMinIntervalMs("4000"), 4000);
	});

	it("falls back to default for invalid values", () => {
		assert.equal(getSiteSearchMinIntervalMs("nope"), 3000);
	});
});
});

// ── Unit tests: parseSearchResults ────────────────────────────────────

describe("parseSearchResults", () => {
	it("parses DDG Lite rust language results", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 5);
		assert.ok(parsed.results.length > 0, "should find results");
		assert.ok(parsed.results.length <= 5, "should respect maxResults");
	});

	it("extracts instant answer", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 5);
		assert.ok(parsed.instantAnswer !== null, "should have instant answer");
		assert.ok(
			parsed.instantAnswer!.includes("general-purpose programming language"),
		);
	});

	it("extracts result titles", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 3);
		assert.ok(
			parsed.results[0].title.length > 0,
			"first result should have a title",
		);
	});

	it("extracts result URLs from DDG redirects", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 5);
		const withUrl = parsed.results.filter((r) => r.url.length > 0);
		assert.ok(withUrl.length > 0, "at least some results should have URLs");
		// URLs should be resolved (not DDG redirect URLs)
		for (const r of withUrl) {
			assert.ok(
				!r.url.includes("duckduckgo.com/l/"),
				`URL should be resolved: ${r.url}`,
			);
		}
	});

	it("extracts domain info", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 5);
		const withDomain = parsed.results.filter((r) => r.domain.length > 0);
		assert.ok(
			withDomain.length > 0,
			"at least some results should have domains",
		);
	});

	it("respects maxResults limit", () => {
		const parsed3 = parseSearchResults(DDG_RUST_RAW, 3);
		assert.ok(parsed3.results.length <= 3);

		const parsed1 = parseSearchResults(DDG_RUST_RAW, 1);
		assert.ok(parsed1.results.length <= 1);
	});

	it("returns empty results for empty input", () => {
		const parsed = parseSearchResults("", 5);
		assert.equal(parsed.results.length, 0);
		assert.equal(parsed.instantAnswer, null);
	});

	it("parses GitHub site-filtered results", () => {
		const parsed = parseSearchResults(DDG_GITHUB_RAW, 5);
		assert.ok(parsed.results.length > 0, "should find github results");
		// All results should be from github.com
		for (const r of parsed.results) {
			if (r.domain) {
				assert.ok(
					r.domain.includes("github.com"),
					`expected github.com domain, got: ${r.domain}`,
				);
			}
		}
	});
});

// ── Unit tests: formatSearchResults ───────────────────────────────────

describe("formatSearchResults", () => {
	it("formats results with titles and URLs", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 3);
		const text = formatSearchResults("rust language", parsed);

		assert.ok(
			text.includes("## Results (3)"),
			"should have results header with count",
		);
		assert.ok(
			text.includes("**Rust Programming Language**"),
			"should have bold title",
		);
		assert.ok(text.includes("URL:"), "should have URL lines");
	});

	it("includes instant answer section when present", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 3);
		const text = formatSearchResults("rust language", parsed);

		assert.ok(
			text.includes("## Instant Answer"),
			"should have instant answer header",
		);
	});

	it("shows no results message when empty", () => {
		const parsed = parseSearchResults("", 5);
		const text = formatSearchResults("empty query", parsed);

		assert.ok(text.includes("No results found for"));
	});

	it("numbers results starting from 1", () => {
		const parsed = parseSearchResults(DDG_RUST_RAW, 3);
		const text = formatSearchResults("rust", parsed);

		assert.ok(text.includes("1. **"), "first result should be numbered 1");
		assert.ok(text.includes("2. **"), "second result should be numbered 2");
	});
});

// ── Integration tests (require lynx) ──────────────────────────────────

// Check if lynx is available before running integration tests
let lynxAvailable = false;
try {
	execSync("which lynx 2>/dev/null", { encoding: "utf8" });
	lynxAvailable = true;
} catch {
	// lynx not available
}

// Import doSearch for integration tests
import { doSearch } from "./index.ts";

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
	fn: () => Promise<T>,
	retries = 3,
	delayMs = 5000,
): Promise<T> {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (err) {
			if (i === retries - 1) throw err;
			await sleep(delayMs);
		}
	}
	throw new Error("unreachable");
}

describe("integration: doSearch", () => {
	const runIntegration =
		lynxAvailable && process.env.PI_LYNX_INTEGRATION === "1";
	const maybeIt = runIntegration ? it : it.skip;

	maybeIt(
		"full search flow: basic, site filters, bang shortcuts, URL resolution",
		{ timeout: 120_000 },
		async () => {
			// 1. Basic search
			const basic = await withRetry(() => doSearch("rust language", 3));
			assert.ok(basic.results.length > 0, "basic search should return results");
			assert.ok(basic.results.length <= 3, "should respect maxResults");
			assert.ok(basic.instantAnswer !== null, "should have instant answer");

			// 2. site:github.com filter
			const github = await withRetry(() =>
				doSearch("pi extension", 3, "site:github.com"),
			);
			assert.ok(
				github.results.length > 0,
				"github filter should return results",
			);
			for (const r of github.results) {
				if (r.domain) assert.ok(r.domain.includes("github.com"));
			}

			// 3. site:wikipedia.org filter
			const wiki = await withRetry(() =>
				doSearch("rust language", 3, "site:wikipedia.org"),
			);
			assert.ok(
				wiki.results.length > 0,
				"wikipedia filter should return results",
			);
			for (const r of wiki.results) {
				if (r.domain) assert.ok(r.domain.includes("wikipedia.org"));
			}

			// 4. !gh bang shortcut converts to site:github.com
			const ghBang = await withRetry(() => doSearch("!gh pi extension", 3));
			assert.ok(ghBang.results.length > 0, "!gh should return results");
			for (const r of ghBang.results) {
				if (r.domain)
					assert.ok(
						r.domain.includes("github.com"),
						`expected github.com, got: ${r.domain}`,
					);
			}

			// 5. !w bang shortcut converts to site:wikipedia.org
			const wBang = await withRetry(() => doSearch("!w rust language", 3));
			assert.ok(wBang.results.length > 0, "!w should return results");
			for (const r of wBang.results) {
				if (r.domain)
					assert.ok(
						r.domain.includes("wikipedia.org"),
						`expected wikipedia.org, got: ${r.domain}`,
					);
			}

			// 6. DDG redirect URLs are resolved to real URLs
			const resolved = await withRetry(() => doSearch("rust language", 3));
			const withUrl = resolved.results.filter(
				(r: { url: string }) => r.url.length > 0,
			);
			assert.ok(withUrl.length > 0, "should have results with URLs");
			for (const r of withUrl) {
				assert.ok(
					!r.url.includes("duckduckgo.com/l/"),
					`URL should be resolved: ${r.url}`,
				);
			}
		},
	);
});

// ── Unit tests: buildRedditThreadJsonUrl / buildRedditSearchJsonUrl ───

describe("buildRedditThreadJsonUrl", () => {
	it("appends .json to a thread URL", () => {
		const url = buildRedditThreadJsonUrl(
			"https://www.reddit.com/r/PiCodingAgent/comments/1t0av3l/title/",
		);
		assert.ok(url.endsWith(".json?raw_json=1") || url.includes(".json"));
		assert.ok(url.startsWith("https://www.reddit.com/r/PiCodingAgent/comments/1t0av3l/title.json"));
	});

	it("normalizes non-www hosts to www.reddit.com", () => {
		const url = buildRedditThreadJsonUrl(
			"https://old.reddit.com/r/PiCodingAgent/comments/1t0av3l/title/",
		);
		assert.ok(url.startsWith("https://www.reddit.com/"));
	});

	it("does not double up .json when already present", () => {
		const url = buildRedditThreadJsonUrl(
			"https://www.reddit.com/r/PiCodingAgent/comments/1t0av3l/title.json",
		);
		assert.ok(!url.includes(".json.json"));
	});
});

describe("buildRedditSearchJsonUrl", () => {
	it("builds a global search URL", () => {
		const url = buildRedditSearchJsonUrl("pi extensions");
		assert.ok(url.startsWith("https://www.reddit.com/search.json"));
		assert.ok(url.includes("q=pi%20extensions") || url.includes("q=pi+extensions"));
	});

	it("scopes to a subreddit when provided", () => {
		const url = buildRedditSearchJsonUrl("extensions", "PiCodingAgent");
		assert.ok(url.startsWith("https://www.reddit.com/r/PiCodingAgent/search.json"));
		assert.ok(url.includes("restrict_sr=1"));
	});
});

describe("buildOldRedditSearchUrl", () => {
	it("builds an old.reddit global search URL", () => {
		const url = buildOldRedditSearchUrl("world cup 2026");
		assert.ok(url.startsWith("https://old.reddit.com/search"));
		assert.ok(url.includes("q=world%20cup%202026") || url.includes("q=world+cup+2026"));
		assert.ok(url.includes("sort=relevance"));
		assert.ok(url.includes("t=all"));
	});

	it("scopes old.reddit search to a subreddit", () => {
		const url = buildOldRedditSearchUrl("world cup 2026", "soccer");
		assert.ok(url.startsWith("https://old.reddit.com/r/soccer/search"));
		assert.ok(url.includes("restrict_sr=on"));
	});
});

// ── Unit tests: parseRedditThread / formatRedditThread ────────────────

describe("parseRedditThread", () => {
	it("extracts post metadata", () => {
		const thread = parseRedditThread(REDDIT_THREAD_JSON, 10);
		assert.equal(thread.subreddit, "PiCodingAgent");
		assert.equal(thread.author, "curious_dev");
		assert.equal(thread.score, 42);
	});

	it("extracts and sorts top-level comments by score, skipping 'more'", () => {
		const thread = parseRedditThread(REDDIT_THREAD_JSON, 10);
		assert.equal(thread.comments.length, 2);
		assert.equal(thread.comments[0].author, "panel_fan");
		assert.ok(thread.comments[0].score >= thread.comments[1].score);
	});

	it("respects maxComments", () => {
		const thread = parseRedditThread(REDDIT_THREAD_JSON, 1);
		assert.equal(thread.comments.length, 1);
	});

	it("throws on unexpected shape", () => {
		assert.throws(() => parseRedditThread({}, 10));
	});
});

describe("formatRedditThread", () => {
	it("renders title, subreddit, and comments", () => {
		const thread = parseRedditThread(REDDIT_THREAD_JSON, 10);
		const text = formatRedditThread(thread);
		assert.ok(text.includes("Is there a list of the best extensions for pi?"));
		assert.ok(text.includes("r/PiCodingAgent"));
		assert.ok(text.includes("panel_fan"));
	});
});

describe("parseOldRedditSearch", () => {
	it("extracts old.reddit search results", () => {
		const results = parseOldRedditSearch(OLD_REDDIT_SEARCH_RAW, 10);
		assert.equal(results.length, 2);
		assert.equal(results[0].subreddit, "soccer");
		assert.equal(results[0].author, "nexxwav");
		assert.equal(results[0].score, 1776);
		assert.equal(results[0].numComments, 946);
		assert.ok(results[0].permalink.startsWith("/r/soccer/comments/1tx8wuy/"));
	});

	it("respects maxResults for old.reddit search", () => {
		const results = parseOldRedditSearch(OLD_REDDIT_SEARCH_RAW, 1);
		assert.equal(results.length, 1);
	});
});

// ── Unit tests: parseRedditSearch / formatRedditSearchResults ─────────

describe("parseRedditSearch", () => {
	it("extracts search results", () => {
		const results = parseRedditSearch(REDDIT_SEARCH_JSON, 10);
		assert.equal(results.length, 2);
		assert.equal(results[0].title, "Best pi extensions megathread");
	});

	it("respects maxResults", () => {
		const results = parseRedditSearch(REDDIT_SEARCH_JSON, 1);
		assert.equal(results.length, 1);
	});
});

describe("formatRedditSearchResults", () => {
	it("renders result list", () => {
		const results = parseRedditSearch(REDDIT_SEARCH_JSON, 10);
		const text = formatRedditSearchResults("pi extensions", results);
		assert.ok(text.includes("Best pi extensions megathread"));
		assert.ok(text.includes("permalink") === false); // no raw key names leaked
	});

	it("handles empty results", () => {
		const text = formatRedditSearchResults("nonexistent query", []);
		assert.ok(text.includes("No reddit results found"));
	});


// ── Unit tests: buildBraveSearchUrl / parseBraveResults ──────────────

describe("buildBraveSearchUrl", () => {
	it("builds a Brave search URL", () => {
		const url = buildBraveSearchUrl("typebox schema");
		assert.ok(url.startsWith("https://search.brave.com/search"));
		assert.ok(url.includes("q=typebox+schema") || url.includes("q=typebox%20schema"));
		assert.ok(url.includes("source=web"));
	});

	it("appends a site filter to the query when provided", () => {
		const url = buildBraveSearchUrl("extensions", "site:github.com");
		assert.ok(url.includes("site%3Agithub.com") || url.includes("site:github.com"));
	});
});

describe("parseBraveResults", () => {
	it("extracts organic results from Brave HTML", () => {
		const results = parseBraveResults(BRAVE_SEARCH_HTML, 10);
		assert.ok(results.length >= 3);
		assert.ok(results[0].url.startsWith("https://"));
		assert.ok(results[0].domain.length > 0);
		assert.ok(results[0].title.length > 0);
		assert.ok(results[0].snippet.length > 0);
	});

	it("strips the breadcrumb and leading site-name from titles", () => {
		const results = parseBraveResults(BRAVE_SEARCH_HTML, 10);
		// Real titles do not contain the rendered breadcrumb separator.
		assert.ok(results.every((r) => !r.title.includes("›")));
	});

	it("respects maxResults", () => {
		const results = parseBraveResults(BRAVE_SEARCH_HTML, 2);
		assert.equal(results.length, 2);
	});

	it("returns [] for HTML with no organic result blocks", () => {
		const results = parseBraveResults("<html>bot check page</html>", 10);
		assert.equal(results.length, 0);
	});
});
});
