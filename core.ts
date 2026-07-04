/**
 * Pure pi-lynx helpers.
 */

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

/** State-machine based parser for DDG Lite search result blocks */
const enum ParseState {
	IDLE = "idle",
	IN_RESULT = "in_result",
}

interface ResultAccumulator {
	title: string;
	titleLinkNum: number | null;
	snippetLines: string[];
	domain: string;
}

function parseResultBlocks(
	lines: string[],
	links: Map<number, string>,
	maxResults: number,
): SearchResult[] {
	const results: SearchResult[] = [];
	let state: ParseState = ParseState.IDLE;
	let acc: ResultAccumulator | null = null;

	function flushAccumulator(): void {
		if (!acc || !acc.title) return;

		let url = "";
		if (acc.titleLinkNum !== null && links.has(acc.titleLinkNum)) {
			url = resolveDdgRedirect(links.get(acc.titleLinkNum) ?? "");
		}

		results.push({
			title: acc.title,
			snippet: acc.snippetLines.join(" "),
			domain: acc.domain,
			url,
		});
		acc = null;
	}

	for (let i = 0; i < lines.length; i++) {
		if (results.length >= maxResults) break;

		const line = lines[i];
		const trimmed = line.trim();

		const titleMatch = /^\s*(\d+)\.\s{2,}(.+)/.exec(line);

		if (titleMatch) {
			if (state === ParseState.IN_RESULT) {
				flushAccumulator();
			}

			if (results.length >= maxResults) break;

			const rawTitle = titleMatch[2];
			const titleLinkMatch = /\[(\d+)\]/.exec(rawTitle);

			acc = {
				title: stripLinkMarkers(rawTitle.trim()),
				titleLinkNum: titleLinkMatch ? parseInt(titleLinkMatch[1], 10) : null,
				snippetLines: [],
				domain: "",
			};
			state = ParseState.IN_RESULT;
			continue;
		}

		if (state === ParseState.IDLE) continue;
		if (!acc) continue;

		if (/^(Next Page|< Previous Page)/.test(trimmed)) {
			flushAccumulator();
			state = ParseState.IDLE;
			continue;
		}

		if (!trimmed) continue;

		if (/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/.test(trimmed) && !/\s/.test(trimmed)) {
			acc.domain = trimmed;
			flushAccumulator();
			state = ParseState.IDLE;
			continue;
		}

		acc.snippetLines.push(stripLinkMarkers(trimmed));
	}

	if (state === ParseState.IN_RESULT && acc) {
		flushAccumulator();
	}

	return results;
}

export function parseSearchResults(
	raw: string,
	maxResults: number,
): ParsedSearch {
	const links = parseLinks(raw);
	const lines = raw.split("\n");
	const instantAnswer = extractInstantAnswer(lines);

	const results = parseResultBlocks(lines, links, maxResults);

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

export function normalizeSearchQuery(
	query: string,
	siteFilter?: string,
): { cleanQuery: string; effectiveFilter?: string } {
	let cleanQuery = query.trim();
	let effectiveFilter = siteFilter;

	if (/^!gh\s+/i.test(cleanQuery)) {
		cleanQuery = cleanQuery.slice(4).trim();
		effectiveFilter ??= "site:github.com";
	} else if (/^!w\s+/i.test(cleanQuery)) {
		cleanQuery = cleanQuery.slice(3).trim();
		effectiveFilter ??= "site:wikipedia.org";
	}

	return { cleanQuery, effectiveFilter };
}

// ── Reddit ──────────────────────────────────────────────────────────

export interface RedditComment {
	author: string;
	score: number;
	body: string;
}

export interface RedditThread {
	title: string;
	author: string;
	subreddit: string;
	score: number;
	numComments: number;
	selftext: string;
	url: string;
	permalink: string;
	comments: RedditComment[];
}

export interface RedditSearchResult {
	title: string;
	subreddit: string;
	author: string;
	score: number;
	numComments: number;
	permalink: string;
}

/** Normalize any reddit thread/comments URL to its `.json` API form. */
export function buildRedditThreadJsonUrl(url: string): string {
	const u = new URL(url);
	u.hostname = "www.reddit.com";
	u.pathname = u.pathname.replace(/\/+$/, "").replace(/\.json$/, "");
	if (!u.pathname.endsWith(".json")) u.pathname += ".json";
	u.searchParams.set("raw_json", "1");
	return u.toString();
}

/** Build a reddit search `.json` URL, optionally scoped to a subreddit. */
export function buildRedditSearchJsonUrl(
	query: string,
	subreddit?: string,
	maxResults = 10,
): string {
	const base = subreddit
		? `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search`
		: "https://www.reddit.com/search";
	const u = new URL(`${base}.json`);
	u.searchParams.set("q", query.trim());
	u.searchParams.set("limit", String(Math.min(Math.max(maxResults, 1), 25)));
	u.searchParams.set("raw_json", "1");
	if (subreddit) u.searchParams.set("restrict_sr", "1");
	return u.toString();
}

/** Build an old.reddit.com search URL, optionally scoped to a subreddit. */
export function buildOldRedditSearchUrl(
	query: string,
	subreddit?: string,
): string {
	const base = subreddit
		? `https://old.reddit.com/r/${encodeURIComponent(subreddit)}/search`
		: "https://old.reddit.com/search";
	const u = new URL(base);
	u.searchParams.set("q", query.trim());
	u.searchParams.set("sort", "relevance");
	u.searchParams.set("t", "all");
	if (subreddit) u.searchParams.set("restrict_sr", "on");
	return u.toString();
}

function parseOldRedditCount(value: string): number {
	return Number.parseInt(value.replace(/,/g, ""), 10);
}

function redditPermalinkFromUrl(url: string): string {
	try {
		const u = new URL(url);
		if (!/reddit\.com$/.test(u.hostname) || !u.pathname.includes("/comments/")) {
			return "";
		}
		return u.pathname;
	} catch {
		return "";
	}
}

function cleanOldRedditLine(line: string): string {
	return stripLinkMarkers(line.trim()).replace(/\s+/g, " ").trim();
}

function cleanOldRedditTitle(title: string): string {
	return title
		.replace(/^(Official Source|Post-Match Thread|Match Thread|Media|Stats|News)(?=\S)/, "$1 ")
		.trim();
}

/** Parse lynx -dump output from old.reddit.com search. */
export function parseOldRedditSearch(raw: string, maxResults: number): RedditSearchResult[] {
	const links = parseLinks(raw);
	const lines = raw.split("\n");
	const results: RedditSearchResult[] = [];

	for (let i = 0; i < lines.length && results.length < maxResults; i++) {
		const rawTitle = lines[i]?.trim() ?? "";
		if (!rawTitle || /^posts$/i.test(rawTitle) || !/\[\d+\]/.test(rawTitle)) continue;

		let metaIdx = -1;
		for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
			if (/\b[\d,]+\s+points?\b.*\b[\d,]+\s+comments?\b/i.test(cleanOldRedditLine(lines[j]))) {
				metaIdx = j;
				break;
			}
		}
		if (metaIdx === -1) continue;

		const title = cleanOldRedditTitle(
			lines.slice(i, metaIdx).map(cleanOldRedditLine).filter(Boolean).join(" "),
		);
		if (!title) continue;

		const rawTitleBlock = lines.slice(i, metaIdx).join("\n");
		const titleLinkNum = /\[(\d+)\]/.exec(rawTitleBlock)?.[1];
		const permalink = titleLinkNum
			? redditPermalinkFromUrl(links.get(Number.parseInt(titleLinkNum, 10)) ?? "")
			: "";
		if (!permalink) continue;

		const metaText = lines
			.slice(metaIdx, Math.min(lines.length, metaIdx + 4))
			.map(cleanOldRedditLine)
			.join(" ");
		const scoreMatch = /([\d,]+)\s+points?/i.exec(metaText);
		const commentsMatch = /([\d,]+)\s+comments?/i.exec(metaText);
		const authorMatch = /\bby\s+([A-Za-z0-9_-]+)/i.exec(metaText);
		const subredditMatch = /\br\/([A-Za-z0-9_]+)/i.exec(metaText);
		if (!scoreMatch || !commentsMatch || !authorMatch || !subredditMatch) continue;

		results.push({
			title,
			subreddit: subredditMatch[1],
			author: authorMatch[1],
			score: parseOldRedditCount(scoreMatch[1]),
			numComments: parseOldRedditCount(commentsMatch[1]),
			permalink,
		});

		i = metaIdx;
	}

	return results;
}

interface RedditListingChild<T> {
	kind: string;
	data: T;
}

interface RedditListing<T> {
	data: { children: RedditListingChild<T>[] };
}

interface RedditPostData {
	title: string;
	author: string;
	subreddit: string;
	score: number;
	num_comments: number;
	selftext: string;
	url: string;
	permalink: string;
}

interface RedditCommentData {
	author: string;
	score: number;
	body: string;
}

/** Parse a reddit `[postListing, commentListing]` thread JSON payload. */
export function parseRedditThread(json: unknown, maxComments: number): RedditThread {
	if (!Array.isArray(json) || json.length < 1) {
		throw new Error("Unexpected reddit thread response shape.");
	}

	const postListing = json[0] as RedditListing<RedditPostData>;
	const post = postListing?.data?.children?.[0]?.data;
	if (!post) throw new Error("Reddit thread post data not found.");

	const commentListing = json[1] as RedditListing<RedditCommentData> | undefined;
	const rawComments = commentListing?.data?.children ?? [];

	const comments = rawComments
		.filter((c) => c.kind === "t1" && typeof c.data?.body === "string")
		.map((c) => ({
			author: c.data.author,
			score: c.data.score,
			body: c.data.body,
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, maxComments);

	return {
		title: post.title,
		author: post.author,
		subreddit: post.subreddit,
		score: post.score,
		numComments: post.num_comments,
		selftext: post.selftext ?? "",
		url: post.url,
		permalink: post.permalink,
		comments,
	};
}

/** Parse a reddit search listing JSON payload. */
export function parseRedditSearch(
	json: unknown,
	maxResults: number,
): RedditSearchResult[] {
	const listing = json as RedditListing<
		RedditPostData & { num_comments: number }
	>;
	const children = listing?.data?.children ?? [];

	return children
		.filter((c) => c.kind === "t3")
		.slice(0, maxResults)
		.map((c) => ({
			title: c.data.title,
			subreddit: c.data.subreddit,
			author: c.data.author,
			score: c.data.score,
			numComments: c.data.num_comments,
			permalink: c.data.permalink,
		}));
}

export function formatRedditThread(thread: RedditThread): string {
	const parts: string[] = [];
	parts.push(`# ${thread.title}`);
	parts.push(
		`r/${thread.subreddit} · u/${thread.author} · ${thread.score} pts · ${thread.numComments} comments\n`,
	);
	if (thread.selftext) parts.push(`${thread.selftext}\n`);

	if (thread.comments.length === 0) {
		parts.push("No comments found.");
		return parts.join("\n");
	}

	parts.push(`## Top comments (${thread.comments.length})\n`);
	for (const c of thread.comments) {
		parts.push(`**u/${c.author}** (${c.score} pts)`);
		parts.push(`${c.body}\n`);
	}

	return parts.join("\n");
}

export function formatRedditSearchResults(
	query: string,
	results: RedditSearchResult[],
): string {
	if (results.length === 0) {
		return `No reddit results found for "${query}".`;
	}

	const parts: string[] = [`## Reddit results (${results.length})\n`];
	for (const [idx, r] of results.entries()) {
		parts.push(`${idx + 1}. **${r.title}**`);
		parts.push(
			`   r/${r.subreddit} · u/${r.author} · ${r.score} pts · ${r.numComments} comments`,
		);
		parts.push(`   https://www.reddit.com${r.permalink}`);
		parts.push("");
	}

	return parts.join("\n");
}
