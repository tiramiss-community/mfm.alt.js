// Differential fuzzing: random inputs must give the same result as mfm.js.
//
// usage: node compare/fuzz.mjs [mode] [cases] [seed] [maxTokens]
//   mode "api"    : compares `parse`, `parseSimple` and `toString` of ../built/index.mjs with refs/base.mjs
//   mode "budget" : compares `parse` with small nest budgets, where nesting is given up halfway.
//                   uses refs/base.budget.mjs and refs/alt-internal.mjs (see build-ref.sh and tsdown.config.ts)
// The reference can be changed with the environment variable BASE (a name in refs).
const mode = process.argv[2] ?? 'api';
const cases = +(process.argv[3] ?? 200000);
const seed = +(process.argv[4] ?? 1);
const maxTokens = +(process.argv[5] ?? 40);
const baseName = process.env.BASE ?? 'base';

import { createGenerator } from './generate.mjs';

const here = new URL('.', import.meta.url);
const load = path => import(new URL(path, here).href);

const { generate, int, pick } = createGenerator(seed, maxTokens);

function attempt(fn) {
	try {
		return JSON.stringify(fn());
	} catch (err) {
		return `throws ${err instanceof RangeError ? 'RangeError' : String(err)}`;
	}
}

let compare;
if (mode === 'api') {
	const base = await load(`./refs/${baseName}.mjs`);
	const alt = await load('../built/index.mjs');
	compare = (text) => {
		const opts = int(3) === 0 ? { nestLimit: pick([0, 1, 2, 3, 5, 100]) } : {};
		return () => {
			const tree = base.parse(text, opts);
			const expected = [JSON.stringify(tree), attempt(() => base.parseSimple(text)), attempt(() => base.toString(tree)), attempt(() => tree.map(node => base.toString(node)))];
			const actual = [attempt(() => alt.parse(text, opts)), attempt(() => alt.parseSimple(text)), attempt(() => alt.toString(tree)), attempt(() => tree.map(node => alt.toString(node)))];
			return expected.join('\n') === actual.join('\n') ? null : JSON.stringify(opts);
		};
	};
} else if (mode === 'budget') {
	const base = await load(`./refs/${baseName}.budget.mjs`);
	const alt = await load('./refs/alt-internal.mjs');
	compare = (text) => {
		const nestLimit = pick([undefined, undefined, 1, 2, 3, 5, 100]);
		const nestBudget = int(4) === 0 ? int(8) : int(text.length * 4 + 8);
		return () => {
			globalThis.__mfmNestBudget = nestBudget;
			const expected = attempt(() => base.parse(text, { nestLimit }));
			const actual = attempt(() => alt.fullParser(text, { nestLimit, nestBudget }));
			return expected === actual ? null : JSON.stringify({ nestLimit, nestBudget });
		};
	};
} else {
	throw new Error(`unknown mode: ${mode}`);
}

const seen = new Set();
let mismatches = 0;
for (let i = 0; i < cases; i++) {
	const text = generate();
	if (seen.size < 3000000) seen.add(text);
	const check = compare(text);
	const detail = check();
	if (detail !== null) {
		// tells a flaky result from a real difference
		const again = check();
		if (mismatches++ < 5) console.log('MISMATCH', JSON.stringify(text), detail, again === null ? '(not reproduced on rerun)' : '');
	}
}
console.log(`mode ${mode} base ${baseName} seed ${seed} maxTokens ${maxTokens}: cases ${cases}, distinct inputs ${seen.size}, mismatches ${mismatches}`);
process.exit(mismatches === 0 ? 0 : 1);
