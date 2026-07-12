/**
 * Search engine adapters + chain.
 *
 * Unifies DDG Lite and Brave behind a common SearchOutcome shape so
 * lynx_web_search can run an ordered chain of engines with fallback on
 * error or empty results, instead of being hard-wired to one engine.
 */

import type { SearchResult } from "./core.ts";
import { doBraveSearch, doSearch } from "./runtime.ts";

export type SearchEngineName = "ddg" | "brave";

export const SEARCH_ENGINE_NAMES: readonly SearchEngineName[] = ["ddg", "brave"];

export interface SearchOutcome {
	results: SearchResult[];
	instantAnswer: string | null;
}

export interface SearchEngineAdapter {
	name: SearchEngineName;
	search(
		query: string,
		maxResults: number,
		siteFilter: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<SearchOutcome>;
}

export const ddgEngine: SearchEngineAdapter = {
	name: "ddg",
	search: (query, maxResults, siteFilter, signal) =>
		doSearch(query, maxResults, siteFilter, signal),
};

export const braveEngine: SearchEngineAdapter = {
	name: "brave",
	async search(query, maxResults, siteFilter, signal) {
		const results = await doBraveSearch(query, maxResults, siteFilter, signal);
		return { results, instantAnswer: null };
	},
};

const ENGINE_REGISTRY: Record<SearchEngineName, SearchEngineAdapter> = {
	ddg: ddgEngine,
	brave: braveEngine,
};

/** Map configured engine names to their adapters, in order. */
export function resolveEngines(names: SearchEngineName[]): SearchEngineAdapter[] {
	return names.map((name) => ENGINE_REGISTRY[name]);
}

export function isSearchEngineName(value: string): value is SearchEngineName {
	return (SEARCH_ENGINE_NAMES as readonly string[]).includes(value);
}

/**
 * Normalize the lynx_web_search "engine" tool parameter to a known value,
 * defaulting to "ddg". Takes `unknown` rather than the TypeBox-inferred
 * param type: conditionally-spread optional schema properties lose their
 * literal type through registerTool's generic `Static<TParams>` inference,
 * so the tool call site would otherwise see this field typed as `{}`.
 */
export function normalizeEngineParam(value: unknown): SearchEngineName | "auto" {
	return value === "brave" || value === "auto" ? value : "ddg";
}

/**
 * Parse PI_LYNX_SEARCH_ENGINES: a comma-separated list such as "ddg,brave".
 * Unset, empty, or containing no recognized engine name all fall back to
 * DDG-only so the default chain never silently does nothing.
 */
export function parseSearchEngineList(value?: string): SearchEngineName[] {
	if (!value) return ["ddg"];

	const engines: SearchEngineName[] = [];
	const seen = new Set<SearchEngineName>();
	for (const raw of value.split(",")) {
		const name = raw.trim().toLowerCase();
		if (isSearchEngineName(name) && !seen.has(name)) {
			seen.add(name);
			engines.push(name);
		}
	}

	return engines.length > 0 ? engines : ["ddg"];
}

const FALSY_VALUES = new Set(["0", "false", "no", "off"]);

/** Parse PI_LYNX_SEARCH_FALLBACK_ON_EMPTY: boolean-ish, default true. */
export function parseFallbackOnEmpty(value?: string): boolean {
	if (value === undefined) return true;
	return !FALSY_VALUES.has(value.trim().toLowerCase());
}

export interface SearchChainResult extends SearchOutcome {
	/** Engine whose outcome was returned. */
	engine: SearchEngineName;
	/** Engines tried, in order, up to and including `engine`. */
	attempted: SearchEngineName[];
	/** True when an earlier engine in the chain was skipped due to an error
	 *  or (when configured) an empty result set. */
	fallbackOccurred: boolean;
}

export class SearchChainError extends Error {
	readonly attempted: SearchEngineName[];
	readonly causes: Error[];

	constructor(attempted: SearchEngineName[], causes: Error[]) {
		super(
			`All configured search engines failed (tried: ${attempted.join(", ") || "none"}): ` +
				causes.map((e) => e.message).join(" | "),
		);
		this.name = "SearchChainError";
		this.attempted = attempted;
		this.causes = causes;
	}
}

function isEmptyOutcome(outcome: SearchOutcome): boolean {
	return outcome.results.length === 0 && !outcome.instantAnswer;
}

/**
 * Run engines in order, advancing to the next one when the current engine
 * throws, or (when fallbackOnEmpty is true) returns no results and no
 * instant answer. The last engine in the chain always resolves the call —
 * its error is thrown or its (possibly empty) outcome is returned, since
 * there is nothing left to fall back to.
 */
export async function runSearchChain(
	query: string,
	maxResults: number,
	siteFilter: string | undefined,
	engines: SearchEngineAdapter[],
	fallbackOnEmpty: boolean,
	signal: AbortSignal | undefined,
): Promise<SearchChainResult> {
	if (engines.length === 0) {
		throw new Error("runSearchChain requires at least one engine.");
	}

	const attempted: SearchEngineName[] = [];
	const errors: Error[] = [];

	for (const [index, engine] of engines.entries()) {
		attempted.push(engine.name);
		const isLast = index === engines.length - 1;

		let outcome: SearchOutcome;
		try {
			outcome = await engine.search(query, maxResults, siteFilter, signal);
		} catch (err: unknown) {
			const error = err instanceof Error ? err : new Error(String(err));
			errors.push(error);
			if (isLast) throw new SearchChainError(attempted, errors);
			continue;
		}

		if (isEmptyOutcome(outcome) && fallbackOnEmpty && !isLast) continue;

		return { ...outcome, engine: engine.name, attempted, fallbackOccurred: index > 0 };
	}

	throw new SearchChainError(attempted, errors);
}
