import { defineConfig } from 'tsdown';

// The parser with its internal options, for compare/fuzz.mjs.
export default defineConfig({
	entry: { 'alt-internal': '../src/parser/index.ts' },
	outDir: './refs',
	clean: false,
	tsconfig: '../tsconfig.json',
	format: 'esm',
	dts: false,
	outExtensions: () => ({ js: '.mjs' }),
});
