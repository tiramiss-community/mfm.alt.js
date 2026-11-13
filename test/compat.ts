//
// Compares the results with a build of mfm-js on random inputs.
// It needs the bundles in compare/refs (see compare/README.md), and is skipped without them.
// compare/fuzz.mjs does the same with more cases.
//

import { describe, test } from 'vitest';
import assert from 'assert';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import * as alt from '../src/index';
import { fullParser } from '../src/parser';
// @ts-expect-error a plain script
import { createGenerator } from '../compare/generate.mjs';

const basePath = fileURLToPath(new URL('../compare/refs/base.mjs', import.meta.url));
const budgetBasePath = fileURLToPath(new URL('../compare/refs/base.budget.mjs', import.meta.url));

describe.skipIf(!existsSync(basePath) || !existsSync(budgetBasePath))('compatibility with mfm-js', () => {
	test('parse, parseSimple and toString', async () => {
		const base: typeof alt = await import(basePath);
		const { generate, int, pick } = createGenerator(1, 40);
		for (let i = 0; i < 30000; i++) {
			const text: string = generate();
			const opts = int(3) === 0 ? { nestLimit: pick([0, 1, 2, 3, 5, 100]) } : {};
			const expected = base.parse(text, opts);
			assert.deepStrictEqual(alt.parse(text, opts), expected, JSON.stringify(text));
			assert.deepStrictEqual(alt.parseSimple(text), base.parseSimple(text), JSON.stringify(text));
			assert.strictEqual(alt.toString(expected), base.toString(expected), JSON.stringify(text));
		}
	});

	test('nesting given up halfway by the nest budget', async () => {
		const base: typeof alt = await import(budgetBasePath);
		const { generate, int, pick } = createGenerator(2, 40);
		try {
			for (let i = 0; i < 30000; i++) {
				const text: string = generate();
				const nestLimit: number | undefined = pick([undefined, undefined, 1, 2, 3, 5, 100]);
				const nestBudget = int(4) === 0 ? int(8) : int(text.length * 4 + 8);
				(globalThis as Record<string, unknown>).__mfmNestBudget = nestBudget;
				assert.deepStrictEqual(fullParser(text, { nestLimit, nestBudget }), base.parse(text, { nestLimit }), JSON.stringify({ text, nestLimit, nestBudget }));
			}
		} finally {
			delete (globalThis as Record<string, unknown>).__mfmNestBudget;
		}
	});
});
