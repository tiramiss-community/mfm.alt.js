// Memory that a build keeps: after import, after the first parse, and after every emoji of emoji-data
// (which grows the trie of mfm.alt.js as far as it goes). Each build runs in its own process.
//
// usage: node compare/footprint.mjs [name=path ...]
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = new URL('.', import.meta.url);

if (process.argv[2] === '--child') {
	const heap = async () => {
		for (let i = 0; i < 4; i++) {
			globalThis.gc();
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		return process.memoryUsage().heapUsed;
	};
	const list = (await import(new URL('../node_modules/@misskey-dev/emoji-data/built/emojilist.json', here).href, { with: { type: 'json' } })).default;
	const allEmojis = list.map(entry => entry[0]).join(' ');
	const h0 = await heap();
	const lib = await import(process.argv[3]);
	const h1 = await heap();
	lib.parse('hello 😀');
	const h2 = await heap();
	lib.parse(allEmojis);
	const h3 = await heap();
	console.log(JSON.stringify([h1 - h0, h2 - h1, h3 - h2]));
} else {
	const targets = process.argv.length > 2
		? process.argv.slice(2).map(arg => arg.split('='))
		: [['base', './refs/base.mjs'], ['alt', '../built/index.mjs']];
	const rows = {};
	for (const [name, path] of targets) {
		const runs = [];
		for (let i = 0; i < 3; i++) {
			const out = execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child', new URL(path, here).href], { encoding: 'utf8' });
			runs.push(JSON.parse(out));
		}
		// the median of each column
		const median = column => runs.map(run => run[column]).sort((a, b) => a - b)[1];
		const kb = bytes => `${Math.round(bytes / 1024)} KB`;
		rows[name] = {
			'import': kb(median(0)),
			'+ first parse': kb(median(1)),
			'+ all emojis': kb(median(2)),
			'total': kb(median(0) + median(1) + median(2)),
		};
	}
	console.table(rows);
}
