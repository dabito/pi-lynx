/**
 * pi-lynx: Web Search & Fetch via Lynx + DuckDuckGo Lite
 *
 * Tools:
 * - lynx_web_fetch: fetch + extract text from URL
 * - lynx_web_search: search via DDG Lite
 * - lynx_web_search_github: GitHub wrapper
 * - lynx_web_search_wikipedia: Wikipedia wrapper
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
	buildDdgLiteUrl,
	formatSearchResults,
	normalizeSearchQuery,
	parseLinks,
	parseSearchResults,
	resolveDdgRedirect,
	stripLinkMarkers,
} from "./core.ts";
import { doFetch, doSearch, getSiteSearchMinIntervalMs } from "./runtime.ts";

export {
	buildDdgLiteUrl,
	formatSearchResults,
	normalizeSearchQuery,
	parseLinks,
	parseSearchResults,
	resolveDdgRedirect,
	stripLinkMarkers,
	doFetch,
	doSearch,
	getSiteSearchMinIntervalMs,
};

interface SearchToolConfig {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	siteFilter?: string;
	contextLabel?: string;
	errorPrefix?: string;
}

function registerSearchTool(pi: ExtensionAPI, config: SearchToolConfig): void {
	const hasSiteFilter = Boolean(config.siteFilter);

	pi.registerTool({
		name: config.name,
		label: config.label,
		description: config.description,
		promptSnippet: config.promptSnippet,
		promptGuidelines: config.promptGuidelines,
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (1–20, default 8)",
					default: 8,
					minimum: 1,
					maximum: 20,
				}),
			),
			...(hasSiteFilter
				? {}
				: {
						site: Type.Optional(
							Type.Union([Type.Literal("github"), Type.Literal("wikipedia")], {
								description: "Restrict search to github.com or wikipedia.org",
							}),
						),
					}),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxResults = Math.min(Math.max(params.max_results ?? 8, 1), 20);

			let siteFilter = config.siteFilter;
			if (!hasSiteFilter) {
				if (params.site === "github") siteFilter = "site:github.com";
				else if (params.site === "wikipedia") siteFilter = "site:wikipedia.org";
			}

			const contextLabel = config.contextLabel ?? "Searching";
			onUpdate?.({
				content: [{ type: "text", text: `${contextLabel}: "${params.query}"...` }],
				details: undefined,
			});

			try {
				const parsed = await doSearch(params.query, maxResults, siteFilter, signal);
				const text = formatSearchResults(params.query, parsed);

				return {
					content: [{ type: "text", text }],
					details: {
						query: params.query,
						resultCount: parsed.results.length,
						hasInstantAnswer: parsed.instantAnswer !== null,
						...(config.siteFilter ? { site: config.siteFilter.replace("site:", "") } : {}),
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				const errorPrefix = config.errorPrefix ?? "Search failed";
				const normalized = normalizeSearchQuery(params.query, siteFilter);
				const retryHint = (normalized.effectiveFilter?.startsWith("site:"))
					? ` DDG Lite often throttles repeated site-filtered searches; retry after ${getSiteSearchMinIntervalMs(process.env.PI_LYNX_SITE_SEARCH_INTERVAL_MS)}ms or try a general search without the site filter.`
					: "";
				return {
					content: [{ type: "text", text: `${errorPrefix}: ${message}${retryHint}` }],
					isError: true,
					details: { query: params.query, error: message },
				};
			}
		},
	});
}

export default function lynxDdgSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "lynx_web_fetch",
		label: "Lynx Web Fetch",
		description:
			"Fetch a web page and extract its text content using lynx. Links are opt-in and capped by default so fetches stay context-safe. Useful for reading articles, documentation, or any URL found via lynx_web_search.",
		promptSnippet: "Fetch and read the text content of a web page via lynx",
		promptGuidelines: [
			"Use lynx_web_fetch to read the full content of a URL returned by lynx_web_search or provided by the user.",
			"The default output is body text only. Add include_links=true only when link references matter.",
			"If you include links, keep them bounded with link_limit.",
			"For very long pages, the output may be truncated.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			max_lines: Type.Optional(
				Type.Number({
					description: "Maximum lines of text to return (default 300)",
					default: 300,
					minimum: 50,
					maximum: 2000,
				}),
			),
			include_links: Type.Optional(
				Type.Boolean({
					description: "Include extracted links section at the end (default false)",
					default: false,
				}),
			),
			link_limit: Type.Optional(
				Type.Number({
					description: "Maximum number of links to include when include_links=true (default 20)",
					default: 20,
					minimum: 0,
					maximum: 200,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxLines = Math.min(Math.max(params.max_lines ?? 300, 50), 2000);
			const includeLinks = params.include_links ?? false;
			const linkLimit = Math.min(Math.max(params.link_limit ?? 20, 0), 200);

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${params.url}...` }],
				details: undefined,
			});

			try {
				const result = await doFetch(params.url, maxLines, includeLinks, linkLimit, signal);

				return {
					content: [{ type: "text", text: result.text }],
					details: {
						url: params.url,
						lineCount: result.lineCount,
						linkCount: result.linkCount,
						linksTruncated: result.linksTruncated,
						truncated: result.truncated,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Fetch failed: ${message}` }],
					isError: true,
					details: { url: params.url, error: message },
				};
			}
		},
	});

	registerSearchTool(pi, {
		name: "lynx_web_search",
		label: "Lynx Web Search",
		description:
			"Search the web using DuckDuckGo Lite via lynx. Returns structured results with titles, snippets, domains, and URLs. No API key required.",
		promptSnippet:
			"Search the web for up-to-date information via DuckDuckGo Lite",
		promptGuidelines: [
			"Use lynx_web_search when you need current information from the internet — recent events, documentation, package versions, error solutions, etc.",
			"lynx_web_search requires lynx to be installed on the system.",
			"Supports !gh (GitHub) and !w (Wikipedia) bang shortcuts, or use the site parameter.",
		],
	});

	registerSearchTool(pi, {
		name: "lynx_web_search_github",
		label: "Lynx GitHub Search",
		description:
			"Search GitHub using DuckDuckGo Lite via lynx. Returns structured results with titles, snippets, domains, and URLs. No API key required.",
		promptSnippet:
			"Search GitHub for repositories, code, and issues via DuckDuckGo Lite",
		promptGuidelines: [
			"Use lynx_web_search_github when you want to find GitHub repositories, code examples, issues, or documentation.",
			"This is a convenience wrapper around lynx_web_search with site:github.com pre-set.",
		],
		siteFilter: "site:github.com",
		contextLabel: "Searching GitHub",
		errorPrefix: "GitHub search failed",
	});

	registerSearchTool(pi, {
		name: "lynx_web_search_wikipedia",
		label: "Lynx Wikipedia Search",
		description:
			"Search Wikipedia using DuckDuckGo Lite via lynx. Returns structured results with titles, snippets, domains, and URLs. No API key required.",
		promptSnippet:
			"Search Wikipedia for articles and reference information via DuckDuckGo Lite",
		promptGuidelines: [
			"Use lynx_web_search_wikipedia when you want to find Wikipedia articles, definitions, or reference information.",
			"This is a convenience wrapper around lynx_web_search with site:wikipedia.org pre-set.",
		],
		siteFilter: "site:wikipedia.org",
		contextLabel: "Searching Wikipedia",
		errorPrefix: "Wikipedia search failed",
	});
}
