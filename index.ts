/**
 * pi-lynx: Web Search & Fetch via Lynx + DuckDuckGo Lite
 *
 * Provides four tools for agents:
 * - lynx_web_fetch:    Fetch and extract text content + links from any URL (base tool)
 * - lynx_web_search:   Search the web via DuckDuckGo Lite (uses lynx_web_fetch internally)
 * - lynx_web_search_github:    Search GitHub via DuckDuckGo Lite (uses lynx_web_search)
 * - lynx_web_search_wikipedia: Search Wikipedia via DuckDuckGo Lite (uses lynx_web_search)
 *
 * Tool composition hierarchy:
 *   lynx_web_fetch (base — lynx -dump + parse)
 *     ↑ used by
 *   lynx_web_search (DDG Lite URL construction + result parsing)
 *     ↑ used by
 *   lynx_web_search_github / lynx_web_search_wikipedia (site-specific wrappers)
 *
 * Zero dependencies — only requires `lynx` on PATH.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Shared helpers (used by all tools) ────────────────────────────────

let _lynxPath: string | null | undefined;

async function findLynx(): Promise<string | null> {
	if (_lynxPath !== undefined) return _lynxPath;
	try {
		const { execSync } = await import("node:child_process");
		const p = execSync("which lynx 2>/dev/null", { encoding: "utf8" }).trim();
		_lynxPath = p || null;
		return _lynxPath ?? null;
	} catch {
		_lynxPath = null;
		return null;
	}
}

async function lynxDump(url: string, timeoutMs = 15_000): Promise<string> {
	const lynxPath = await findLynx();
	if (!lynxPath) throw new Error("lynx not found on PATH. Install lynx first.");

	// NOTE: intentionally NOT using -nolist so we get the References section with all URLs
	// Using default Lynx UA — custom UAs trigger DDG bot detection
	const { stdout } = await execFileAsync(
		lynxPath,
		["-dump", "-assume_charset=UTF-8", "-display_charset=UTF-8", url],
		{ timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 },
	);

	return stdout;
}

/** Extract the [N] → URL mapping from lynx's References section */
export function parseLinks(raw: string): Map<number, string> {
	const links = new Map<number, string>();
	const lines = raw.split("\n");

	let inRefs = false;
	for (const line of lines) {
		const trimmed = line.trim();

		if (
			/^References$/.test(trimmed) ||
			/^Visible links:$/.test(trimmed) ||
			/^Hidden links:$/.test(trimmed)
		) {
			inRefs = true;
			continue;
		}

		if (!inRefs) continue;

		const match = /^\s*(\d+)\.\s+(https?:\/\/\S+)/.exec(trimmed);
		if (match) {
			links.set(parseInt(match[1], 10), match[2]);
		}
	}

	return links;
}

/** Resolve a DDG redirect URL to the actual target URL */
export function resolveDdgRedirect(url: string): string {
	try {
		const u = new URL(url);
		if (u.hostname === "duckduckgo.com" && u.pathname === "/l/") {
			const uddg = u.searchParams.get("uddg");
			if (uddg) return decodeURIComponent(uddg);
		}
	} catch {
		/* not a valid URL, return as-is */
	}
	return url;
}

/** Strip [N] link markers from text */
export function stripLinkMarkers(text: string): string {
	return text.replace(/\[(\d+)\]/g, "");
}

// ── lynx_web_fetch internals (base layer) ─────────────────────────────

interface FetchResult {
	text: string;
	lineCount: number;
	linkCount: number;
	truncated: boolean;
}

async function doFetch(
	url: string,
	maxLines: number,
	includeLinks: boolean,
): Promise<FetchResult> {
	const raw = await lynxDump(url);
	const links = parseLinks(raw);
	const lines = raw.split("\n");

	const refsStart = lines.findIndex(
		(l) => /^References$/.test(l.trim()) || /^Visible links:$/.test(l.trim()),
	);

	const bodyEnd = refsStart !== -1 ? refsStart : lines.length;
	const bodyLines = lines.slice(0, bodyEnd);
	const cleanBody = bodyLines.map(stripLinkMarkers);

	let start = 0;
	for (let i = 0; i < Math.min(10, cleanBody.length); i++) {
		const t = cleanBody[i].trim();
		if (
			t &&
			!/^#?\s*$/.test(t) &&
			!/^(Jump to|Skip|Menu|Navigation)/i.test(t)
		) {
			start = i;
			break;
		}
	}

	const content = cleanBody.slice(start, start + maxLines).join("\n");
	const truncated = cleanBody.length - start > maxLines;

	let text = truncated
		? `${content}\n\n--- [truncated at ${maxLines} lines, ${cleanBody.length - start - maxLines} more lines omitted] ---`
		: content;

	if (includeLinks && links.size > 0) {
		const linkEntries = Array.from(links.entries())
			.sort(([a], [b]) => a - b)
			.map(([num, href]) => `  [${num}] ${resolveDdgRedirect(href)}`);

		text += `\n\n## Links (${links.size})\n${linkEntries.join("\n")}`;
	}

	return {
		text,
		lineCount: bodyLines.length,
		linkCount: links.size,
		truncated,
	};
}

// ── lynx_web_search internals ─────────────────────────────────────────

export interface SearchResult {
	title: string;
	snippet: string;
	domain: string;
	url: string;
}

export interface ParsedSearch {
	instantAnswer: string | null;
	results: SearchResult[];
}

/** Extract the instant answer from DDG Lite "Zero-click info:" section */
function extractInstantAnswer(lines: string[]): string | null {
	const zcIdx = lines.findIndex((l) => /Zero-click info:/i.test(l));
	if (zcIdx === -1) return null;

	const zcLines: string[] = [];
	for (let i = zcIdx + 1; i < lines.length; i++) {
		if (/^\s*\d+\.\s/.test(lines[i])) break;
		const trimmed = stripLinkMarkers(lines[i].trim());
		if (trimmed && !/^More at/.test(trimmed)) zcLines.push(trimmed);
	}

	return zcLines.length > 0 ? zcLines.join(" ") : null;
}

/** Parse a single numbered result block from DDG Lite output */
function parseResultBlock(
	lines: string[],
	startIdx: number,
	links: Map<number, string>,
): { result: SearchResult | null; nextIdx: number } {
	const match = /^\s*(\d+)\.\s{2,}(.+)/.exec(lines[startIdx]);
	if (!match) return { result: null, nextIdx: startIdx + 1 };

	const title = stripLinkMarkers(match[2].trim());
	const snippetLines: string[] = [];
	let domain = "";
	let resultLinkNum: number | null = null;
	let i = startIdx + 1;

	const titleLinkMatch = /\[(\d+)\]/.exec(match[2]);
	if (titleLinkMatch) resultLinkNum = parseInt(titleLinkMatch[1], 10);

	while (i < lines.length) {
		const line = lines[i];
		if (/^\s*\d+\.\s{2,}/.test(line)) break;
		if (/^(Next Page|< Previous Page)/.test(line.trim())) {
			i++;
			break;
		}
		const trimmed = line.trim();
		if (!trimmed) {
			i++;
			continue;
		}
		if (
			/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/.test(trimmed) &&
			!/\s/.test(trimmed)
		) {
			domain = trimmed;
			i++;
			break;
		}
		snippetLines.push(stripLinkMarkers(trimmed));
		i++;
	}

	let url = "";
	if (resultLinkNum !== null && links.has(resultLinkNum)) {
		url = resolveDdgRedirect(links.get(resultLinkNum) ?? "");
	}

	return {
		result: title
			? { title, snippet: snippetLines.join(" "), domain, url }
			: null,
		nextIdx: i,
	};
}

export function parseSearchResults(
	raw: string,
	maxResults: number,
): ParsedSearch {
	const links = parseLinks(raw);
	const lines = raw.split("\n");
	const results: SearchResult[] = [];
	const instantAnswer = extractInstantAnswer(lines);

	let i = 0;
	while (i < lines.length && results.length < maxResults) {
		const { result, nextIdx } = parseResultBlock(lines, i, links);
		if (result) results.push(result);
		i = nextIdx;
	}

	return { instantAnswer, results };
}

export function buildDdgLiteUrl(query: string, siteFilter?: string): string {
	const q = query.trim() + (siteFilter ? ` ${siteFilter}` : "");
	return `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
}

export function formatSearchResults(
	query: string,
	parsed: ParsedSearch,
): string {
	const { instantAnswer, results } = parsed;

	if (results.length === 0 && !instantAnswer) {
		return `No results found for "${query}".`;
	}

	const parts: string[] = [];
	if (instantAnswer) {
		parts.push(`## Instant Answer\n${instantAnswer}\n`);
	}
	parts.push(`## Results (${results.length})\n`);
	for (const [idx, r] of results.entries()) {
		parts.push(`${idx + 1}. **${r.title}**`);
		if (r.url) parts.push(`   URL: ${r.url}`);
		if (r.domain && !r.url) parts.push(`   Domain: ${r.domain}`);
		if (r.snippet) parts.push(`   ${r.snippet}`);
		parts.push("");
	}

	return parts.join("\n");
}

export async function doSearch(
	query: string,
	maxResults: number,
	siteFilter?: string,
): Promise<ParsedSearch> {
	let cleanQuery = query.trim();
	let effectiveFilter = siteFilter;

	if (/^!gh\s+/i.test(cleanQuery)) {
		cleanQuery = cleanQuery.slice(4).trim();
		effectiveFilter = "site:github.com";
	} else if (/^!w\s+/i.test(cleanQuery)) {
		cleanQuery = cleanQuery.slice(3).trim();
		effectiveFilter = "site:wikipedia.org";
	}

	const url = buildDdgLiteUrl(cleanQuery, effectiveFilter);
	const raw = await lynxDump(url);
	return parseSearchResults(raw, maxResults);
}

// ── Tool registration helpers ─────────────────────────────────────────

interface SearchToolConfig {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	siteFilter?: string;
	/** Label prefix shown in onUpdate messages, e.g. "Searching GitHub" */
	contextLabel?: string;
	/** Error prefix shown on failure, e.g. "GitHub search failed" */
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
		async execute(_toolCallId, params, _signal, onUpdate) {
			const maxResults = Math.min(Math.max(params.max_results ?? 8, 1), 20);

			let siteFilter = config.siteFilter;
			if (!hasSiteFilter) {
				if (params.site === "github") siteFilter = "site:github.com";
				else if (params.site === "wikipedia") siteFilter = "site:wikipedia.org";
			}

			const contextLabel = config.contextLabel ?? "Searching";
			onUpdate?.({
				content: [
					{ type: "text", text: `${contextLabel}: "${params.query}"...` },
				],
				details: undefined,
			});

			try {
				const parsed = await doSearch(params.query, maxResults, siteFilter);
				const text = formatSearchResults(params.query, parsed);

				return {
					content: [{ type: "text", text }],
					details: {
						query: params.query,
						resultCount: parsed.results.length,
						hasInstantAnswer: parsed.instantAnswer !== null,
						...(config.siteFilter
							? { site: config.siteFilter.replace("site:", "") }
							: {}),
					},
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				const errorPrefix = config.errorPrefix ?? "Search failed";
				return {
					content: [{ type: "text", text: `${errorPrefix}: ${message}` }],
					isError: true,
					details: { query: params.query, error: message },
				};
			}
		},
	});
}

// ── Extension: register tools ─────────────────────────────────────────

export default function lynxDdgSearch(pi: ExtensionAPI) {
	// ── 1. lynx_web_fetch (base tool) ──

	pi.registerTool({
		name: "lynx_web_fetch",
		label: "Lynx Web Fetch",
		description:
			"Fetch a web page and extract its text content and links using lynx. Useful for reading articles, documentation, or any URL found via lynx_web_search. Returns page text with a Links section listing all extracted URLs.",
		promptSnippet: "Fetch and read the text content of a web page via lynx",
		promptGuidelines: [
			"Use lynx_web_fetch to read the full content of a URL returned by lynx_web_search or provided by the user.",
			"lynx_web_fetch returns plain text plus a Links section with all URLs found on the page.",
			"For very long pages, the output may be truncated but the Links section is always included.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL to fetch" }),
			max_lines: Type.Optional(
				Type.Number({
					description:
						"Maximum lines of text to return (default 300, excludes Links section)",
					default: 300,
					minimum: 50,
					maximum: 2000,
				}),
			),
			include_links: Type.Optional(
				Type.Boolean({
					description:
						"Include extracted links section at the end (default true)",
					default: true,
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, onUpdate) {
			const maxLines = Math.min(Math.max(params.max_lines ?? 300, 50), 2000);
			const includeLinks = params.include_links ?? true;

			onUpdate?.({
				content: [{ type: "text", text: `Fetching: ${params.url}...` }],
				details: undefined,
			});

			try {
				const result = await doFetch(params.url, maxLines, includeLinks);

				return {
					content: [{ type: "text", text: result.text }],
					details: {
						url: params.url,
						lineCount: result.lineCount,
						linkCount: result.linkCount,
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

	// ── 2. lynx_web_search (general search, supports site param) ──

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

	// ── 3. lynx_web_search_github ──

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

	// ── 4. lynx_web_search_wikipedia ──

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
