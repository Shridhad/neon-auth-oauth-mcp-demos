import { defineConfig } from "tsdown";

export default defineConfig({
	name: "@neon/oauth",
	bundle: true,
	clean: true,
	dts: true,
	entry: [
		"src/index.ts",
		"src/verify/index.ts",
		"src/adapter.ts",
		"src/hono.ts",
		"src/express.ts",
		"src/next.ts",
		"src/node.ts",
		"src/mcp/index.ts",
		"src/mcp/hono.ts",
		"src/mcp/express.ts",
		"src/mcp/next.ts",
		"src/mcp/node.ts",
	],
	format: "esm",
	// With a hash, `dist/index.d.ts` becomes `dist/index-<hash>.d.ts` and `types` stops resolving.
	hash: false,
	outDir: "dist",
	treeshake: true,
	// Package imports stay runtime imports; only relative modules are bundled.
	external: (id) =>
		!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
});
