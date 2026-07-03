import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerLynxTools from "./index.ts";

type ToolSchema = {
	properties?: {
		include_links?: { default?: boolean };
		link_limit?: { default?: number };
		max_lines?: { default?: number };
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
			],
		);
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
});
