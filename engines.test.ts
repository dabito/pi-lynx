/**
 * engines.ts tests: env parsing + search chain ordering/fallback using
 * mock engine adapters (no network).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	normalizeEngineParam,
	parseFallbackOnEmpty,
	parseSearchEngineList,
	resolveEngines,
	runSearchChain,
	SearchChainError,
	type SearchEngineAdapter,
	type SearchOutcome,
} from "./engines.ts";

function mockEngine(
	name: "ddg" | "brave",
	impl: (
		query: string,
		maxResults: number,
		siteFilter: string | undefined,
	) => Promise<SearchOutcome>,
): SearchEngineAdapter {
	return { name, search: impl };
}

const result = (title: string) => ({
	title,
	snippet: "",
	domain: "example.com",
	url: "https://example.com",
});

async function failWith(message: string): Promise<SearchOutcome> {
	throw new Error(message);
}

// ── Env parsing ─────────────────────────────────────────────────────────

describe("parseSearchEngineList", () => {
	it("defaults to ddg when unset", () => {
		assert.deepEqual(parseSearchEngineList(undefined), ["ddg"]);
	});

	it("defaults to ddg when empty", () => {
		assert.deepEqual(parseSearchEngineList(""), ["ddg"]);
	});

	it("parses a comma list preserving order", () => {
		assert.deepEqual(parseSearchEngineList("ddg,brave"), ["ddg", "brave"]);
		assert.deepEqual(parseSearchEngineList("brave,ddg"), ["brave", "ddg"]);
	});

	it("trims whitespace and lowercases", () => {
		assert.deepEqual(parseSearchEngineList(" Brave , DDG "), ["brave", "ddg"]);
	});

	it("dedupes repeated entries", () => {
		assert.deepEqual(parseSearchEngineList("ddg,ddg,brave"), ["ddg", "brave"]);
	});

	it("falls back to ddg when no recognized engine is present", () => {
		assert.deepEqual(parseSearchEngineList("bing,yahoo"), ["ddg"]);
	});

	it("drops unrecognized entries but keeps valid ones", () => {
		assert.deepEqual(parseSearchEngineList("bing,brave"), ["brave"]);
	});
});

describe("parseFallbackOnEmpty", () => {
	it("defaults to true when unset", () => {
		assert.equal(parseFallbackOnEmpty(undefined), true);
	});

	it("treats common falsy strings as false", () => {
		for (const v of ["0", "false", "No", "OFF", "  false  "]) {
			assert.equal(parseFallbackOnEmpty(v), false, `expected ${v} to be false`);
		}
	});

	it("treats everything else (including garbage) as true", () => {
		for (const v of ["1", "true", "yes", "on", "garbage"]) {
			assert.equal(parseFallbackOnEmpty(v), true, `expected ${v} to be true`);
		}
	});
});

describe("normalizeEngineParam", () => {
	it("passes through recognized values", () => {
		assert.equal(normalizeEngineParam("brave"), "brave");
		assert.equal(normalizeEngineParam("auto"), "auto");
	});

	it("defaults ddg, undefined, and unrecognized values to ddg", () => {
		assert.equal(normalizeEngineParam("ddg"), "ddg");
		assert.equal(normalizeEngineParam(undefined), "ddg");
		assert.equal(normalizeEngineParam("bogus"), "ddg");
		assert.equal(normalizeEngineParam(123), "ddg");
	});
});

describe("resolveEngines", () => {
	it("maps names to adapters in order", () => {
		const adapters = resolveEngines(["brave", "ddg"]);
		assert.deepEqual(adapters.map((a) => a.name), ["brave", "ddg"]);
	});
});

// ── Chain ordering / fallback ────────────────────────────────────────────

describe("runSearchChain", () => {
	it("returns the first engine's outcome with no fallback when it succeeds", async () => {
		const ddg = mockEngine("ddg", async () => ({
			results: [result("ddg result")],
			instantAnswer: null,
		}));
		const brave = mockEngine("brave", () => failWith("brave should not be called"));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], true, undefined);
		assert.equal(chainResult.engine, "ddg");
		assert.equal(chainResult.fallbackOccurred, false);
		assert.deepEqual(chainResult.attempted, ["ddg"]);
		assert.equal(chainResult.results[0].title, "ddg result");
	});

	it("falls back to the next engine on error", async () => {
		const ddg = mockEngine("ddg", () => failWith("ddg down"));
		const brave = mockEngine("brave", async () => ({
			results: [result("brave result")],
			instantAnswer: null,
		}));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], true, undefined);
		assert.equal(chainResult.engine, "brave");
		assert.equal(chainResult.fallbackOccurred, true);
		assert.deepEqual(chainResult.attempted, ["ddg", "brave"]);
	});

	it("falls back to the next engine on empty results when fallbackOnEmpty is true", async () => {
		const ddg = mockEngine("ddg", async () => ({ results: [], instantAnswer: null }));
		const brave = mockEngine("brave", async () => ({
			results: [result("brave result")],
			instantAnswer: null,
		}));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], true, undefined);
		assert.equal(chainResult.engine, "brave");
		assert.equal(chainResult.fallbackOccurred, true);
	});

	it("does not fall back on empty results when fallbackOnEmpty is false", async () => {
		const ddg = mockEngine("ddg", async () => ({ results: [], instantAnswer: null }));
		const brave = mockEngine("brave", () => failWith("brave should not be called"));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], false, undefined);
		assert.equal(chainResult.engine, "ddg");
		assert.equal(chainResult.results.length, 0);
		assert.equal(chainResult.fallbackOccurred, false);
	});

	it("treats an instant answer as non-empty even with zero results", async () => {
		const ddg = mockEngine("ddg", async () => ({ results: [], instantAnswer: "42" }));
		const brave = mockEngine("brave", () => failWith("brave should not be called"));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], true, undefined);
		assert.equal(chainResult.engine, "ddg");
		assert.equal(chainResult.instantAnswer, "42");
	});

	it("returns the last engine's empty outcome when the chain is exhausted", async () => {
		const ddg = mockEngine("ddg", async () => ({ results: [], instantAnswer: null }));
		const brave = mockEngine("brave", async () => ({ results: [], instantAnswer: null }));

		const chainResult = await runSearchChain("q", 8, undefined, [ddg, brave], true, undefined);
		assert.equal(chainResult.engine, "brave");
		assert.equal(chainResult.results.length, 0);
		assert.equal(chainResult.fallbackOccurred, true);
	});

	it("throws a SearchChainError with all causes when every engine fails", async () => {
		const ddg = mockEngine("ddg", () => failWith("ddg down"));
		const brave = mockEngine("brave", () => failWith("brave down"));

		await assert.rejects(
			() => runSearchChain("q", 8, undefined, [ddg, brave], true, undefined),
			(err: unknown) => {
				assert.ok(err instanceof SearchChainError);
				assert.deepEqual(err.attempted, ["ddg", "brave"]);
				assert.deepEqual(err.causes.map((e) => e.message), ["ddg down", "brave down"]);
				return true;
			},
		);
	});

	it("does not fall back past a single-engine chain (back-compat default)", async () => {
		const ddg = mockEngine("ddg", () => failWith("ddg down"));

		await assert.rejects(
			() => runSearchChain("q", 8, undefined, [ddg], true, undefined),
			SearchChainError,
		);
	});

	it("passes the site filter through to the engine adapter", async () => {
		let receivedSiteFilter: string | undefined;
		const ddg = mockEngine("ddg", async (_query, _maxResults, siteFilter) => {
			receivedSiteFilter = siteFilter;
			return { results: [result("r")], instantAnswer: null };
		});

		await runSearchChain("q", 8, "site:github.com", [ddg], true, undefined);
		assert.equal(receivedSiteFilter, "site:github.com");
	});
});
