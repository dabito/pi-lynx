import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
	buildBraveSearchUrl,
	buildDdgLiteUrl,
	buildOldRedditSearchUrl,
	buildRedditThreadJsonUrl,
	normalizeSearchQuery,
	parseBraveResults,
	parseLinks,
	parseOldRedditSearch,
	parseRedditThread,
	parseSearchResults,
	resolveDdgRedirect,
	stripLinkMarkers,
	type RedditSearchResult,
	type RedditThread,
	type SearchResult,
} from "./core.ts";

const execFileAsync = promisify(execFile);

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

async function lynxDump(
	url: string,
	timeoutMs = 15_000,
	signal?: AbortSignal,
): Promise<string> {
	const lynxPath = await findLynx();
	if (!lynxPath) throw new Error("lynx not found on PATH. Install lynx first.");

	const { stdout } = await execFileAsync(
		lynxPath,
		["-dump", "-assume_charset=UTF-8", "-display_charset=UTF-8", url],
		{ timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, signal },
	);

	return stdout;
}

const DEFAULT_SITE_SEARCH_MIN_INTERVAL_MS = 3000;
const MIN_SITE_SEARCH_MIN_INTERVAL_MS = 1000;

export function getSiteSearchMinIntervalMs(value?: string): number {
	if (!value) return DEFAULT_SITE_SEARCH_MIN_INTERVAL_MS;

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) return DEFAULT_SITE_SEARCH_MIN_INTERVAL_MS;

	return Math.max(MIN_SITE_SEARCH_MIN_INTERVAL_MS, parsed);
}

const SITE_SEARCH_MIN_INTERVAL_MS = getSiteSearchMinIntervalMs(
	typeof process !== "undefined" ? process.env.PI_LYNX_SITE_SEARCH_INTERVAL_MS : undefined,
);
let lastSiteSearchAt = 0;
let siteSearchQueue: Promise<void> = Promise.resolve();

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	if (signal?.aborted) return Promise.reject(new Error("Search cancelled."));

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(cleanupAndResolve, ms);

		function cleanupAndResolve(): void {
			signal?.removeEventListener("abort", cleanupAndReject);
			resolve();
		}

		function cleanupAndReject(): void {
			clearTimeout(timeout);
			reject(new Error("Search cancelled."));
		}

		signal?.addEventListener("abort", cleanupAndReject, { once: true });
	});
}

async function waitForSiteSearchSlot(signal?: AbortSignal): Promise<void> {
	const run = siteSearchQueue.catch(() => undefined).then(async () => {
		const waitMs = Math.max(0, lastSiteSearchAt + SITE_SEARCH_MIN_INTERVAL_MS - Date.now());
		await sleep(waitMs, signal);
		lastSiteSearchAt = Date.now();
	});

	siteSearchQueue = run.catch(() => undefined);
	await run;
}

function isSiteFilteredSearch(siteFilter?: string): boolean {
	return Boolean(siteFilter?.startsWith("site:"));
}

export interface FetchResult {
	text: string;
	lineCount: number;
	linkCount: number;
	linksTruncated: boolean;
	truncated: boolean;
}

export async function doFetch(
	url: string,
	maxLines: number,
	includeLinks: boolean,
	linkLimit: number,
	signal?: AbortSignal,
): Promise<FetchResult> {
	const raw = await lynxDump(url, 15_000, signal);
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
		if (t && !/^#?\s*$/.test(t) && !/^(Jump to|Skip|Menu|Navigation)/i.test(t)) {
			start = i;
			break;
		}
	}

	const content = cleanBody.slice(start, start + maxLines).join("\n");
	const truncated = cleanBody.length - start > maxLines;

	let text = truncated
		? `${content}\n\n--- [truncated at ${maxLines} lines, ${cleanBody.length - start - maxLines} more lines omitted] ---`
		: content;

	let linksTruncated = false;
	if (includeLinks && links.size > 0) {
		const cappedLinkLimit = Math.max(0, linkLimit);
		const linkEntries = Array.from(links.entries())
			.sort(([a], [b]) => a - b)
			.slice(0, cappedLinkLimit)
			.map(([num, href]) => `  [${num}] ${resolveDdgRedirect(href)}`);

		linksTruncated = links.size > cappedLinkLimit;
		text += `\n\n## Links (${Math.min(links.size, cappedLinkLimit)})\n${linkEntries.join("\n")}`;
		if (linksTruncated) {
			text += `\n\n--- [${links.size - cappedLinkLimit} more links omitted] ---`;
		}
	}

	return {
		text,
		lineCount: bodyLines.length,
		linkCount: links.size,
		linksTruncated,
		truncated,
	};
}

export async function doSearch(
	query: string,
	maxResults: number,
	siteFilter?: string,
	signal?: AbortSignal,
): Promise<ReturnType<typeof parseSearchResults>> {
	const { cleanQuery, effectiveFilter } = normalizeSearchQuery(query, siteFilter);
	if (isSiteFilteredSearch(effectiveFilter)) {
		await waitForSiteSearchSlot(signal);
	}
	const url = buildDdgLiteUrl(cleanQuery, effectiveFilter);
	const raw = await lynxDump(url, 15_000, signal);
	return parseSearchResults(raw, maxResults);
}

// ── Reddit ────────────────────────────────────────────────────────────

const REDDIT_USER_AGENT = "pi-lynx/1.x (+https://github.com/dabito/pi-lynx)";

async function fetchRedditJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	signal?.addEventListener("abort", () => controller.abort(), { once: true });

	let res: Response;
	try {
		res = await fetch(url, {
			headers: { "User-Agent": REDDIT_USER_AGENT, Accept: "application/json" },
			signal: controller.signal,
		});
	} catch (err: unknown) {
		if (controller.signal.aborted) {
			throw new Error("Reddit request timed out or was cancelled.", { cause: err });
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}

	const contentType = res.headers.get("content-type") ?? "";
	if (!res.ok || !contentType.includes("json")) {
		throw new Error(
			`Reddit returned ${res.status} ${res.statusText || ""} (non-JSON response — likely a bot check). ` +
				"Retry later or from a different network; pi-lynx cannot bypass Reddit's anti-bot wall.",
		);
	}

	return res.json();
}

export async function doRedditFetch(
	url: string,
	maxComments: number,
	signal?: AbortSignal,
): Promise<RedditThread> {
	const jsonUrl = buildRedditThreadJsonUrl(url);
	const json = await fetchRedditJson(jsonUrl, 15_000, signal);
	return parseRedditThread(json, maxComments);
}

export async function doRedditSearch(
	query: string,
	subreddit: string | undefined,
	maxResults: number,
	signal?: AbortSignal,
): Promise<RedditSearchResult[]> {
	const url = buildOldRedditSearchUrl(query, subreddit);
	const raw = await lynxDump(url, 15_000, signal);
	return parseOldRedditSearch(raw, maxResults);
}
// ── Brave Search ──────────────────────────────────────────────────────

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Fetch Brave Search server-rendered HTML with a browser User-Agent so the
 *  SvelteKit SSR payload (organic `data-type="web"` blocks) is returned. */
async function fetchBraveHtml(
	url: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	signal?.addEventListener("abort", () => controller.abort(), { once: true });

	let res: Response;
	try {
		res = await fetch(url, {
			headers: {
				"User-Agent": BROWSER_USER_AGENT,
				Accept: "text/html,application/xhtml+xml",
				"Accept-Language": "en-US,en;q=0.9",
			},
			signal: controller.signal,
		});
	} catch (err: unknown) {
		if (controller.signal.aborted) {
			throw new Error("Brave search request timed out or was cancelled.", {
				cause: err,
			});
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}

	if (!res.ok) {
		throw new Error(
			`Brave returned ${res.status} ${res.statusText || ""}. ` +
				"Retry later or from a different network.",
		);
	}

	return res.text();
}

export async function doBraveSearch(
	query: string,
	maxResults: number,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const url = buildBraveSearchUrl(query);
	const html = await fetchBraveHtml(url, 15_000, signal);
	const results = parseBraveResults(html, maxResults);

	// Zero organic blocks usually means a bot-check/challenge page rather than
	// a genuine empty result set — surface a clear, non-retryable-by-itself error.
	if (results.length === 0 && !/data-type="web"/.test(html)) {
		throw new Error(
			"Brave returned no parseable organic results (possible bot check). " +
				"Retry later or from a different network.",
		);
	}

	return results;
}
