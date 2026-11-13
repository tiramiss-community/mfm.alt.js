// Random inputs for the differential tests (fuzz.mjs and test/compat.ts).

/**
 * @param {number} seed
 * @param {number} maxTokens
 * @returns {{ generate: () => string, int: (n: number) => number, pick: <T>(list: T[]) => T }}
 */
export function createGenerator(seed, maxTokens) {
	// mulberry32: only 32 bit integer operations, so the state does not lose precision
	let state = seed >>> 0;
	function random() {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	const int = n => Math.floor(random() * n);
	const pick = list => list[int(list.length)];

	const tokens = [
		// marks
		'**', '*', '***', '__', '_', '~~', '`', '```', '```js\n', '\n```', '\\(', '\\)', '\\[', '\\]', '\n\\]',
		'<b>', '</b>', '<i>', '</i>', '<s>', '</s>', '<small>', '</small>', '<center>', '</center>', '\n</center>', '<plain>', '</plain>', '\n</plain>',
		'$[', '$[x2 ', '$[spin.speed=1s ', '$[flip.h,v ', '$[x ', '.a=1,b ', '.a=,b ', '.a,,b ', '$[a.__proto__=1 ', '$[a.1,0=z,b=-.x ', ']', '[', '?[', '(', ')', '](', '](https://x.y)', '](<https://x.y>)',
		'@', '@a', '@b@ex.com', '@a.', '@-a', '@a@.b', '@a@b-', '@a.@b', '#', '#tag', '#123', '#a(b)c', '#「a」', '#（a）', '#[a]', ':', ':emoji:', ':a+b-1_:',
		'http', 'https://', 'http://', 'https://ex.com/a', 'https://ex.com/a(b)c', 'https://ex.com/[a].,', 'https://.,', '<https://x.y/z>', '<http://a>', '<https://a b>',
		'search', ' 検索', ' search', '[検索]', ' [検索]', 'Search', ' SEARCH', ' [search]', ' [Search]', '[search]', '索', '検索', ' 検', ' search]', ' [search',
		'>', '> ', '>>', '>\n>', '\n', '\r\n', '\r', '\n\n', ' ', '\u3000', '\t',
		// characters
		'a', 'b', 'h', 'H', 'Z', '0', '1', '2', '3x', 'x_y', 'a*b*', '_a_', ' *a* ', '__a b__', 'ht', 'htt', 'http:', 'http:/', 'ttp', 's://', 'h ', ' h',
		'あ', '漢', '。', '、', '「', '」', '（', '）', '【', '】', '.', ',', '-', '!', '?', '=', '/', '\\', '|', '&', '%', '+', ';', '"', '\'', '{', '}', '^', '<', '</', '< >', '´', '$', '~',
		'é', 'ü', '한', 'я', 'ß', '！', '？', '＃', '＠', '：', '＊', 'ー', 'ｱ', '\v', '\f', '\u00a0', '\u2028', '\u0085',
		// emojis and their parts
		'#️⃣', '1️⃣', '😀', '👍🏽', '🇯🇵', '👨‍👩‍👧', '❤️', '🏃‍♂️‍➡️', '🧑🏻‍❤️‍💋‍🧑🏿', '☺', '✨', '〰', '〽', '㊗', '㊙', '©', '®', '™', '‼', '\uE50A',
		'\uFE0F', '\uFE0E', '\u20E3', '0\u20E3', '9\uFE0F', '*\uFE0F\u20E3', '#\u20E3', '\u200D', '\uD83C', '\uD83D', '\uDFFB', '\uDE00',
	];

	// a soup of the tokens
	function soup() {
		const count = 1 + int(maxTokens);
		let text = '';
		for (let i = 0; i < count; i++) text += pick(tokens);
		return text;
	}

	// a few tokens repeated many times, which tends to make deep nesting and retries
	function repeated() {
		const kinds = 1 + int(3);
		const set = [];
		for (let i = 0; i < kinds; i++) set.push(pick(tokens));
		const count = 1 + int(maxTokens * 2);
		let text = '';
		for (let i = 0; i < count; i++) text += pick(set);
		return text;
	}

	// well-formed syntaxes nested in each other, sometimes broken
	function structured(depth) {
		const leaf = () => pick(['a', 'あ b', ':e:', '😀', '@u', '#t', 'https://e.x/p', 'x y', '\n', ' ', pick(tokens)]);
		if (depth <= 0) return leaf();
		const inner = () => {
			let text = '';
			for (let i = 1 + int(3); i > 0; i--) text += structured(depth - 1 - int(2));
			return text;
		};
		const wraps = [
			() => `**${inner()}**`, () => `***${inner()}***`, () => `<b>${inner()}</b>`, () => `<i>${inner()}</i>`, () => `<s>${inner()}</s>`,
			() => `<small>${inner()}</small>`, () => `~~${inner()}~~`, () => `$[x2 ${inner()}]`, () => `$[a.b=1,c ${inner()}]`,
			() => `[${inner()}](https://e.x/${pick(['', 'a', '(b)', '.'])})`, () => `?[${inner()}](<https://e.x>)`,
			() => `<center>${pick(['', '\n'])}${inner()}${pick(['', '\n'])}</center>${pick(['', '\n'])}`,
			() => `${pick(['', '\n'])}> ${inner().replace(/\n/g, '\n> ')}${pick(['', '\n', '\n\n'])}`,
			() => `<plain>${inner()}</plain>`, () => `\`${inner()}\``, () => `\\(${inner()}\\)`,
			() => `\n\`\`\`${pick(['', 'js'])}\n${inner()}\n\`\`\`\n`, () => `\n\\[${inner()}\\]\n`,
			() => `#a(${inner()})`, () => `https://e.x/(${inner()})`, () => `\n${inner()} ${pick(['search', '[検索]'])}\n`,
			() => inner() + inner(),
		];
		let text = pick(wraps)();
		// break it sometimes
		if (int(4) === 0 && text.length > 1) {
			const at = int(text.length);
			text = text.slice(0, at) + text.slice(at + 1 + int(3));
		}
		return text;
	}

	function generate() {
		switch (int(4)) {
			case 0: return repeated();
			case 1: return structured(1 + int(6));
			default: return soup();
		}
	}

	return { generate, int, pick };
}
