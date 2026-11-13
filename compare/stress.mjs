// Crafted inputs: the time must not blow up as the input grows, and the result must be the same as mfm.js.
//
// usage: node compare/stress.mjs [name=path ...]
const here = new URL('.', import.meta.url);
const targets = process.argv.length > 2
	? process.argv.slice(2).map(arg => arg.split('='))
	: [['base', './refs/base.mjs'], ['alt', '../built/index.mjs']];
const libs = [];
for (const [name, path] of targets) {
	libs.push({ name, lib: await import(new URL(path, here).href) });
}

const units = {
	'open brackets': '[',
	'silent links': '?[a',
	'unclosed links': '[a](',
	'broken link tails': '[a](https://a b)',
	'center tags': '<center>a',
	'center in lines': '\n<center>\n',
	'bold marks': '**a',
	'big marks': '***',
	'fn opens': '$[x ',
	'nested tags': '<b><i><s><small>',
	'quotes': '> ',
	'quote lines': '>a\n',
	'nested quote lines': '>>>>>>>>\n',
	'math inline opens': '\\(a',
	'math block opens': '\n\\[\n',
	'code block opens': '\n```\na',
	'plain opens': '<plain>a',
	'url alt opens': '<https://a',
	'backticks': '`a´',
	'hashtag brackets': '#a(',
	'hashtag nested': '#(「（[',
	'url brackets': 'https://a(',
	'url nested': 'https://(([[',
	'mentions': '@a@',
	'emoji codes': ':a',
	'underscores': '_a',
	'asterisks': '*a ',
	'keycap parts': '1️',
	'zwj chains': '👨‍',
	'search lines': 'a search\n',
	'spaces before search': ' search',
	'newlines': '\n',
	'crlf': '\r\n',
	'fn in link': '[$[x ',
	'link in fn': '$[x [a',
	'center with link': '<center>[a',
	'quote with center': '> <center>a\n',
};

const sizes = [1000, 4000, 16000];
const rows = {};
let different = 0;
for (const [label, unit] of Object.entries(units)) {
	const row = {};
	for (const { name, lib } of libs) {
		const times = [];
		for (const size of sizes) {
			const text = unit.repeat(Math.ceil(size / unit.length));
			const start = process.hrtime.bigint();
			const result = JSON.stringify(lib.parse(text));
			times.push(Number(process.hrtime.bigint() - start) / 1e6);
			if (name === libs[0].name) {
				row[`_${size}`] = result;
			} else if (row[`_${size}`] !== result) {
				different++;
				console.log(`DIFFERENT: ${label} x${size} (${name})`);
			}
		}
		row[`${name} ms`] = times.map(time => time.toFixed(1)).join(' / ');
	}
	rows[label] = Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('_')));
}
console.log(`time for inputs of ${sizes.join(' / ')} characters`);
console.table(rows);
console.log(`different results: ${different}`);
process.exit(different === 0 ? 0 : 1);
