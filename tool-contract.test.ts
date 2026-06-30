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

type RegisteredTool = {
	name: string;
	parameters: ToolSchema;
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
			],
		);
	});
});
