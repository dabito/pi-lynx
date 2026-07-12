/**
 * pi-lynx: Web Search & Fetch via Lynx + DuckDuckGo Lite
 *
 * Tools:
 * - lynx_web_fetch: fetch + extract text from URL
 * - lynx_web_search: search via DDG Lite
 * - lynx_web_search_github: GitHub wrapper
 * - lynx_web_search_wikipedia: Wikipedia wrapper
 * - lynx_reddit_fetch: fetch a reddit thread (post + top comments) via reddit's .json API
 * - lynx_reddit_search: search reddit via old.reddit.com
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	buildBraveSearchUrl,
	buildDdgLiteUrl,
	buildOldRedditSearchUrl,
	formatRedditSearchResults,
	formatRedditThread,
	formatSearchResults,
	normalizeSearchQuery,
	parseBraveResults,
	parseLinks,
	parseOldRedditSearch,
	parseRedditSearch,
	parseRedditThread,
	parseSearchResults,
	resolveDdgRedirect,
	stripLinkMarkers,
} from "./core.ts";
import {
	doBraveSearch,
	doFetch,
	doRedditFetch,
	doRedditSearch,
	doSearch,
	getSiteSearchMinIntervalMs,
} from "./runtime.ts";
import {
	normalizeEngineParam,
	parseFallbackOnEmpty,
	parseSearchEngineList,
	resolveEngines,
	runSearchChain,
	type SearchEngineName,
} from "./engines.ts";

export {
	buildBraveSearchUrl,
	buildDdgLiteUrl,
	buildOldRedditSearchUrl,
	formatRedditSearchResults,
	formatRedditThread,
	formatSearchResults,
	normalizeSearchQuery,
	parseBraveResults,
	parseLinks,
	parseOldRedditSearch,
	parseRedditSearch,
	parseRedditThread,
	parseSearchResults,
	resolveDdgRedirect,
	stripLinkMarkers,
	doBraveSearch,
	doFetch,
	doRedditFetch,
	doRedditSearch,
	doSearch,
	getSiteSearchMinIntervalMs,
	normalizeEngineParam,
	parseFallbackOnEmpty,
	parseSearchEngineList,
	resolveEngines,
	runSearchChain,
};
export type { SearchEngineName };

interface SearchToolConfig {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	siteFilter?: string;
	contextLabel?: string;
	errorPrefix?: string;
	/** Expose the "engine" ddg/brave/auto selector param (lynx_web_search only). */
	supportsEngineSelection?: boolean;
}

type ThemeLike = {
	fg: (name: never, text: string) => string;
	bold: (text: string) => string;
};

type RenderComponent = {
	render(width: number): string[];
	invalidate(): void;
};

const VISUAL = {
	success: { fallback: "✓", nerd: "󰄬", nerdCodepoint: "f012c", theme: "success" },
	warning: { fallback: "◐", nerd: "", nerdCodepoint: "f05d", theme: "warning" },
	info: { fallback: "•", nerd: "󰋽", nerdCodepoint: "f02fd", theme: "accent" },
	failure: { fallback: "✗", nerd: "✗", theme: "error" },
} as const;

type VisualState = keyof typeof VISUAL;

function stateIcon(theme: ThemeLike, state: VisualState): string {
	const visual = VISUAL[state];
	return theme.fg(visual.theme as never, visual.nerd);
}

// Delegates to pi-tui's own width measurement (ANSI escapes from theme.fg,
// tabs, and wide/emoji graphemes from arbitrary fetched web/reddit content
// all need to be measured correctly here). A length/slice-based truncation
// undercounts wide content and can slice mid-escape-sequence, corrupting the
// very same rendering pi-tui re-measures — the bug class that crashed a
// real pi session in a sibling extension (pi-hledit, see its CHANGELOG).
function truncateLine(line: string, width: number): string {
	return truncateToWidth(line, width, "…");
}

function makeComponent(lines: string[]): RenderComponent {
	return {
		render(width: number) {
			return lines.map((line) => truncateLine(line, width));
		},
		invalidate() {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(value: unknown, keys: string[]): string | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "string" && item.length > 0) return item;
	}
	return undefined;
}

function firstNumber(value: unknown, keys: string[]): number | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of keys) {
		const item = value[key];
		if (typeof item === "number") return item;
	}
	return undefined;
}

function renderToolCall(label: string, args: unknown, theme: ThemeLike): RenderComponent {
	const target = firstString(args, ["query", "url", "path", "subreddit"]);
	const limit = firstNumber(args, ["max_results", "max_lines", "max_comments", "link_limit"]);
	const title = theme.fg("toolTitle" as never, theme.bold(`${label}:`));
	const targetText = target ? ` ${theme.fg("accent" as never, target)}` : "";
	const limitText = limit !== undefined ? theme.fg("warning" as never, ` · ${limit}`) : "";
	return makeComponent([`${title}${targetText}${limitText}`]);
}

function renderToolResult(label: string, result: unknown, theme: ThemeLike): RenderComponent {
	const payload = isRecord(result) ? result : {};
	const content = Array.isArray(payload.content) ? payload.content : [];
	const first = isRecord(content[0]) ? content[0] : undefined;
	const text = typeof first?.text === "string" ? first.text : "";
	const details = isRecord(payload.details) ? payload.details : {};
	const isError = payload.isError === true || details.ok === false;
	const lines = text ? text.split(/\r?\n/) : [];

	if (isError) {
		const firstLine = lines.find(Boolean) ?? `${label} failed.`;
		return makeComponent([`${stateIcon(theme, "failure")} ${firstLine}`]);
	}

	if (lines.length > 20) {
		return makeComponent([
			`${stateIcon(theme, "info")} ${label} folded: ${lines.length} lines`,
			lines[0] ?? "",
			`... (${lines.length - 2} lines) ...`,
			lines[lines.length - 1] ?? "",
		]);
	}

	const count = firstNumber(details, ["resultCount", "lineCount", "commentCount", "linkCount"]);
	const countText = count !== undefined ? ` ${count}` : "";
	const summary = lines[0] ?? `${label} ok.${countText}`;
	return makeComponent([`${stateIcon(theme, "success")} ${summary}`, ...lines.slice(1)]);
}

function registerSearchTool(pi: ExtensionAPI, config: SearchToolConfig): void {
	const hasSiteFilter = Boolean(config.siteFilter);

	pi.registerTool({
		name: config.name,
		label: config.label,
		description: config.description,
		promptSnippet: config.promptSnippet,
		promptGuidelines: config.promptGuidelines,
		renderCall(args, theme) {
			return renderToolCall(config.label, args, theme as ThemeLike);
		},
		renderResult(result, _options, theme) {
			return renderToolResult(config.label, result, theme as ThemeLike);
		},
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
			...(config.supportsEngineSelection
				? {
						engine: Type.Optional(
							Type.Union(
								[Type.Literal("ddg"), Type.Literal("brave"), Type.Literal("auto")],
								{
									description:
										'Search engine to use: "ddg" (default), "brave", or "auto" ' +
										"(runs the PI_LYNX_SEARCH_ENGINES chain with fallback)",
									default: "ddg",
								},
							),
						),
					}
				: {}),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxResults = Math.min(Math.max(params.max_results ?? 8, 1), 20);

			let siteFilter = config.siteFilter;
			if (!hasSiteFilter) {
				if (params.site === "github") siteFilter = "site:github.com";
				else if (params.site === "wikipedia") siteFilter = "site:wikipedia.org";
			}

			const engineParam = config.supportsEngineSelection
				? normalizeEngineParam(params.engine)
				: "ddg";
			const engineNames: SearchEngineName[] =
				engineParam === "auto"
					? parseSearchEngineList(process.env.PI_LYNX_SEARCH_ENGINES)
					: [engineParam];
			const fallbackOnEmpty = parseFallbackOnEmpty(process.env.PI_LYNX_SEARCH_FALLBACK_ON_EMPTY);

			const contextLabel = config.contextLabel ?? "Searching";
			onUpdate?.({
				content: [{ type: "text", text: `${contextLabel}: "${params.query}"...` }],
				details: undefined,
			});

			try {
				const chainResult = await runSearchChain(
					params.query,
					maxResults,
					siteFilter,
					resolveEngines(engineNames),
					fallbackOnEmpty,
					signal,
				);
				const text = formatSearchResults(params.query, chainResult);

				return {
					content: [{ type: "text", text }],
					details: {
						query: params.query,
						resultCount: chainResult.results.length,
						hasInstantAnswer: chainResult.instantAnswer !== null,
						source: chainResult.engine,
						fallbackOccurred: chainResult.fallbackOccurred,
						...(config.siteFilter ? { site: config.siteFilter.replace("site:", "") } : {}),
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				const errorPrefix = config.errorPrefix ?? "Search failed";
				const normalized = normalizeSearchQuery(params.query, siteFilter);
				const retryHint = (normalized.effectiveFilter?.startsWith("site:") && engineNames.includes("ddg"))
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
		renderCall(args, theme) {
			return renderToolCall("Lynx Web Fetch", args, theme as ThemeLike);
		},
		renderResult(result, _options, theme) {
			return renderToolResult("Lynx Web Fetch", result, theme as ThemeLike);
		},
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
			'Defaults to DuckDuckGo Lite. Set engine="brave" to use Brave instead, or engine="auto" to run the configured PI_LYNX_SEARCH_ENGINES chain with fallback.',
		],
		supportsEngineSelection: true,
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

	pi.registerTool({
		name: "lynx_reddit_fetch",
		label: "Lynx Reddit Fetch",
		description:
			"Fetch a Reddit thread and return compact agent-readable text: post title/body plus top comments sorted by score. Uses Reddit's public JSON endpoint internally; no API key required.",
		promptSnippet: "Fetch a Reddit thread's post and top comments",
		promptGuidelines: [
			"Use lynx_reddit_fetch for a reddit.com thread/comments URL when you need the post body and top comments.",
			"Returns compact text, not raw JSON: title, subreddit, author, score, post body, and top comments sorted by score.",
			"If Reddit returns a bot-check page instead of JSON, the tool fails with a clear error — retry later or from a different network; it cannot be bypassed.",
		],
		renderCall(args, theme) {
			return renderToolCall("Lynx Reddit Fetch", args, theme as ThemeLike);
		},
		renderResult(result, _options, theme) {
			return renderToolResult("Lynx Reddit Fetch", result, theme as ThemeLike);
		},
		parameters: Type.Object({
			url: Type.String({ description: "Reddit thread/comments URL" }),
			max_comments: Type.Optional(
				Type.Number({
					description: "Maximum number of top-level comments to include (1–50, default 10)",
					default: 10,
					minimum: 1,
					maximum: 50,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxComments = Math.min(Math.max(params.max_comments ?? 10, 1), 50);

			onUpdate?.({
				content: [{ type: "text", text: `Fetching reddit thread: ${params.url}...` }],
				details: undefined,
			});

			try {
				const thread = await doRedditFetch(params.url, maxComments, signal);
				const text = formatRedditThread(thread);

				return {
					content: [{ type: "text", text }],
					details: {
						source: "reddit.json",
						url: params.url,
						permalink: thread.permalink,
						subreddit: thread.subreddit,
						commentCount: thread.comments.length,
						maxComments,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Reddit fetch failed: ${message}` }],
					isError: true,
					details: { source: "reddit.json", url: params.url, error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "lynx_reddit_search",
		label: "Lynx Reddit Search",
		description:
			"Search Reddit threads via old.reddit.com and return compact agent-readable results: titles, subreddits, authors, scores, comment counts, and permalinks. No API key required.",
		promptSnippet: "Search Reddit threads, optionally within one subreddit",
		promptGuidelines: [
			"Use lynx_reddit_search to find Reddit discussions by keyword, optionally scoped with the subreddit parameter.",
			"Uses old.reddit.com because Reddit's JSON endpoint often blocks bot-like traffic.",
			"Returns compact text, not raw HTML/JSON: title, subreddit, author, score, comment count, and permalink.",
			"Use lynx_reddit_fetch on a result permalink when you need the post body and top comments.",
		],
		renderCall(args, theme) {
			return renderToolCall("Lynx Reddit Search", args, theme as ThemeLike);
		},
		renderResult(result, _options, theme) {
			return renderToolResult("Lynx Reddit Search", result, theme as ThemeLike);
		},
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			subreddit: Type.Optional(
				Type.String({ description: "Restrict search to this subreddit (without r/ prefix)" }),
			),
			max_results: Type.Optional(
				Type.Number({
					description: "Maximum number of results to return (1–25, default 10)",
					default: 10,
					minimum: 1,
					maximum: 25,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxResults = Math.min(Math.max(params.max_results ?? 10, 1), 25);

			onUpdate?.({
				content: [{ type: "text", text: `Searching reddit: "${params.query}"...` }],
				details: undefined,
			});

			try {
				const results = await doRedditSearch(params.query, params.subreddit, maxResults, signal);
				const text = formatRedditSearchResults(params.query, results);

				return {
					content: [{ type: "text", text }],
					details: {
						source: "old.reddit",
						query: params.query,
						subreddit: params.subreddit,
						resultCount: results.length,
						maxResults,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Reddit search failed: ${message}` }],
					isError: true,
					details: { source: "old.reddit", query: params.query, error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "lynx_brave_search",
		label: "Lynx Brave Search",
		description:
			"Search the web via Brave Search and return compact agent-readable results: titles, snippets, domains, and URLs. No API key required. Useful as an alternative index when DuckDuckGo Lite (lynx_web_search) throttles or returns poor results.",
		promptSnippet: "Search the web via Brave Search (alternative to lynx_web_search)",
		promptGuidelines: [
			"Use lynx_brave_search as an alternative to lynx_web_search when DDG Lite throttles, returns poor results, or a second index/ranking is wanted.",
			"Uses Brave Search's server-rendered HTML directly (not lynx); no API key needed.",
			"Returns compact text: title, snippet, domain, and url per result.",
			"Use lynx_web_fetch on a result url when you need the full page content.",
		],
		renderCall(args, theme) {
			return renderToolCall("Lynx Brave Search", args, theme as ThemeLike);
		},
		renderResult(result, _options, theme) {
			return renderToolResult("Lynx Brave Search", result, theme as ThemeLike);
		},
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
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const maxResults = Math.min(Math.max(params.max_results ?? 8, 1), 20);

			onUpdate?.({
				content: [{ type: "text", text: `Searching Brave: "${params.query}"...` }],
				details: undefined,
			});

			try {
				const results = await doBraveSearch(params.query, maxResults, undefined, signal);
				const text = formatSearchResults(params.query, {
					instantAnswer: null,
					results,
				});

				return {
					content: [{ type: "text", text }],
					details: {
						source: "brave",
						query: params.query,
						resultCount: results.length,
						maxResults,
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Brave search failed: ${message}` }],
					isError: true,
					details: { source: "brave", query: params.query, error: message },
				};
			}
		},
	});
}
