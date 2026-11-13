// Compares the time of `parse` between builds.
//
// usage: node compare/bench.mjs [name=path ...]
// default: the bundles in compare/refs (see build-ref.sh) and ../built/index.mjs
import { inputs } from './inputs.mjs';

const here = new URL('.', import.meta.url);
const targets = process.argv.length > 2
	? process.argv.slice(2).map(arg => arg.split('='))
	: [['base', './refs/base.mjs'], ['pr1-stage1', './refs/pr1-stage1.mjs'], ['pr1', './refs/pr1.mjs'], ['alt', '../built/index.mjs']];
const libs = [];
for (const [name, path] of targets) {
	libs.push({ name, lib: await import(new URL(path, here).href) });
}

const simple = process.env.SIMPLE === '1';
const run = (lib, text) => simple ? lib.parseSimple(text) : lib.parse(text);

const rows = {};
for (const [inputName, text] of Object.entries(inputs)) {
	const iterations = Math.max(30, Math.floor(200000 / text.length));
	for (const { lib } of libs) {
		for (let i = 0; i < 200; i++) run(lib, text);
	}
	const best = libs.map(() => Infinity);
	// the builds run by turns, so that a fluctuation of the machine hits all of them
	for (let round = 0; round < 9; round++) {
		libs.forEach(({ lib }, index) => {
			const start = process.hrtime.bigint();
			for (let i = 0; i < iterations; i++) run(lib, text);
			best[index] = Math.min(best[index], Number(process.hrtime.bigint() - start) / iterations / 1000);
		});
	}
	const row = { chars: text.length };
	libs.forEach(({ name }, index) => {
		row[`${name} µs`] = +best[index].toFixed(best[index] < 10 ? 2 : 1);
	});
	libs.slice(1).forEach(({ name }, index) => {
		row[`${name} vs ${libs[0].name}`] = (best[0] / best[index + 1]).toFixed(1) + 'x';
	});
	rows[inputName] = row;
}
console.table(rows);
