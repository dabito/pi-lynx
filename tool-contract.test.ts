import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerLynxTools from "./index.ts";

type ToolSchema = {
	properties?: {
		include_links?: { default?: boolean };
		link_limit?: { default?: number };
		max_lines?: { default?: number };
		engine?: { default?: string; anyOf?: unknown[] };
	};
};

type RenderComponent = {
	render(width: number): string[];
};

type ThemeStub = {
	fg: (name: string, text: string) => string;
	bold: (text: string) => string;
};

type RegisteredTool = {
	name: string;
	parameters: ToolSchema;
	renderCall?: (args: Record<string, unknown>, theme: ThemeStub) => RenderComponent;
	renderResult?: (result: Record<string, unknown>, options: Record<string, unknown>, theme: ThemeStub) => RenderComponent;
};

const theme: ThemeStub = {
	fg: (name, text) => `<${name}>${text}</${name}>`,
	bold: (text) => `**${text}**`,
};

function collectTools(): RegisteredTool[] {
	const tools: RegisteredTool[] = [];
	registerLynxTools({
		registerTool(tool: RegisteredTool) {
			tools.push(tool);
		},
	} as never);
	return tools;
}

describe("tool contract", () => {
	it("registers bounded fetch defaults", () => {
		const tools = collectTools();
		const fetch = tools.find((t) => t.name === "lynx_web_fetch");
		assert.ok(fetch, "lynx_web_fetch registered");
		assert.equal(fetch?.parameters.properties?.include_links?.default, false);
		assert.equal(fetch?.parameters.properties?.link_limit?.default, 20);
		assert.equal(fetch?.parameters.properties?.max_lines?.default, 300);
	});

	it("registers expected tool names", () => {
		const tools = collectTools();
		assert.deepEqual(
			tools.map((t) => t.name),
			[
				"lynx_web_fetch",
				"lynx_web_search",
				"lynx_web_search_github",
				"lynx_web_search_wikipedia",
				"lynx_reddit_fetch",
				"lynx_reddit_search",
				"lynx_brave_search",
			],
		);
	});

	it("gives lynx_web_search an opt-in engine selector defaulting to ddg", () => {
		const tools = collectTools();
		const search = tools.find((t) => t.name === "lynx_web_search");
		assert.ok(search, "lynx_web_search registered");
		assert.equal(search?.parameters.properties?.engine?.default, "ddg");
	});

	it("does not add the engine selector to site-scoped or brave-only tools", () => {
		const tools = collectTools();
		for (const name of [
			"lynx_web_search_github",
			"lynx_web_search_wikipedia",
			"lynx_brave_search",
		]) {
			const tool = tools.find((t) => t.name === name);
			assert.ok(tool, `${name} registered`);
			assert.equal(tool?.parameters.properties?.engine, undefined, `${name} should not expose engine`);
		}
	});

	it("renders calls with pi-hledit visual pattern", () => {
		const fetch = collectTools().find((t) => t.name === "lynx_web_fetch");
		assert.ok(fetch?.renderCall);
		assert.deepEqual(
			fetch.renderCall({ url: "https://example.com", max_lines: 80 }, theme).render(120),
			[
				"<toolTitle>**Lynx Web Fetch:**</toolTitle> <accent>https://example.com</accent><warning> · 80</warning>",
			],
		);
	});

	it("renders long results with canonical info glyph", () => {
		const search = collectTools().find((t) => t.name === "lynx_web_search");
		assert.ok(search?.renderResult);
		const rendered = search.renderResult(
			{
				content: [
					{
						type: "text",
						text: Array.from({ length: 24 }, (_, i) => `line ${i + 1}`).join("\n"),
					},
				],
				details: { resultCount: 8 },
			},
			{},
			theme,
		);
		assert.deepEqual(rendered.render(80), [
			"<accent>󰋽</accent> Lynx Web Search folded: 24 lines",
			"line 1",
			"... (22 lines) ...",
			"line 24",
		]);
		assert.equal("󰋽".codePointAt(0)?.toString(16), "f02fd");
	});

	// Fetched web/reddit content can contain tabs and wide/emoji graphemes,
	// and folded titles/errors are pre-colored with real ANSI escapes (see
	// renderToolCall/renderToolResult using theme.fg). A length/slice-based
	// truncation undercounts wide content and can slice mid-escape-sequence
	// — the same bug class that crashed a real pi session in pi-hledit (see
	// its CHANGELOG). Sweep a range of widths and assert the rendered lines
	// never exceed the requested width.
	it("truncation never exceeds the requested width, with tabs/ANSI/wide content", async () => {
		const { visibleWidth } = await import("@earendil-works/pi-tui");
		const search = collectTools().find((t) => t.name === "lynx_web_search");
		assert.ok(search?.renderResult);

		const realTheme: ThemeStub = {
			fg: (name, text) => `\x1b[38;2;125;207;255m${text}\x1b[39m<${name}>`,
			bold: (text) => `\x1b[1m${text}\x1b[22m`,
		};

		const trickyLines = [
			"col1\tcol2\tcol3 tab-separated table row from a fetched page",
			"emoji-heavy line 🚀🔥✨ with wide CJK 你好世界 mixed in",
			"a very long plain ascii line meant to force truncation at small widths too",
			"",
		];

		const rendered = search.renderResult(
			{ content: [{ type: "text", text: trickyLines.join("\n") }], details: { resultCount: 4 } },
			{},
			realTheme,
		);

		for (let width = 0; width <= 120; width++) {
			for (const line of rendered.render(width)) {
				assert.ok(
					visibleWidth(line) <= width,
					`render(${width}) produced a line of visual width ${visibleWidth(line)}: ${JSON.stringify(line)}`,
				);
			}
		}
	});
});
