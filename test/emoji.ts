import { describe, test } from 'vitest';
import assert from 'assert';
import { emojiRegex } from '@misskey-dev/emoji-data';
import { createEmojiMatcher } from '../src/emoji';

// the result that mfm-js gets by the regexp
function reference(source: string): (input: string, index: number) => number {
	const re = new RegExp(source, 'y');
	return (input, index) => {
		re.lastIndex = index;
		return re.test(input) ? re.lastIndex : -1;
	};
}

function random(seed: number): (n: number) => number {
	// mulberry32
	let state = seed >>> 0;
	return (n) => {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * n);
	};
}

describe('emoji matcher', () => {
	describe('emojiRegex of emoji-data', () => {
		const matcher = createEmojiMatcher(emojiRegex.source);
		const expected = reference(emojiRegex.source);

		test('is compiled into a trie', () => {
			assert.notStrictEqual(matcher.firstCodes, null);
		});

		test('first code units', () => {
			const firstCodes = new Set(matcher.firstCodes);
			for (let code = 0; code < 0x10000; code++) {
				const ch = String.fromCharCode(code);
				// a code unit that is not a first one never starts a match
				if (!firstCodes.has(code)) {
					for (const rest of ['', '️', '️⃣', '⃣', '‍', '🏻', '\uDE00']) {
						assert.strictEqual(expected(ch + rest, 0), -1, `U+${code.toString(16)}`);
					}
				}
			}
		});

		test('every code unit with typical followers', () => {
			for (let code = 0; code < 0x10000; code++) {
				for (const rest of ['', '️', '︎', '⃣', '️⃣', '‍', 'a', '\uDE00', '\uDC68‍']) {
					const input = String.fromCharCode(code) + rest;
					assert.strictEqual(matcher.match(input, 0), expected(input, 0), JSON.stringify(input));
				}
			}
		});

		test('random sequences of the code units in the regexp', () => {
			const pool = new Set<number>([0x41, 0x23, 0x2a, 0x30, 0xfe0e, 0xfe0f, 0x20e3, 0x200d]);
			for (const found of emojiRegex.source.matchAll(/\\u([0-9a-f]{4})/gi)) {
				pool.add(parseInt(found[1], 16));
			}
			const codes = [...pool];
			const next = random(1);
			for (let i = 0; i < 300000; i++) {
				let input = 'x';
				for (let length = 1 + next(12); length > 0; length--) {
					input += String.fromCharCode(codes[next(codes.length)]);
				}
				assert.strictEqual(matcher.match(input, 1), expected(input, 1), JSON.stringify(input));
			}
		});

		test('emojis broken at random positions', () => {
			// walks the trie deep: takes real matches and cuts, joins or alters them
			const samples = ['👨‍👩‍👧‍👦', '🧑🏻‍❤️‍💋‍🧑🏿', '🏃🏽‍♂️‍➡️', '👩🏾‍🦽‍➡️', '🏳️‍⚧️', '🏴‍☠️', '🇯🇵', '👁️‍🗨️', '❤️‍🔥', '🧑‍🧑‍🧒‍🧒', '😶‍🌫️', '#️⃣', '9️⃣', '©️', '™', '🐦‍⬛', '🫱🏻‍🫲🏿', '⛹🏿‍♀️'];
			const next = random(2);
			for (let i = 0; i < 300000; i++) {
				let input = samples[next(samples.length)] + samples[next(samples.length)];
				const at = next(input.length);
				switch (next(4)) {
					case 0: input = input.slice(0, at); break;
					case 1: input = input.slice(0, at) + input.slice(at + 1); break;
					case 2: input = input.slice(0, at) + samples[next(samples.length)].charAt(next(4)) + input.slice(at); break;
					default: input = input.slice(0, at) + input.slice(at + 1 + next(3));
				}
				const index = next(3);
				assert.strictEqual(matcher.match(input, index), expected(input, index), JSON.stringify(input));
			}
		});
	});

	describe('regexp syntax', () => {
		// every string of the alphabet up to the length, at every position
		function assertSame(source: string, alphabet: string, maxLength: number): void {
			const matcher = createEmojiMatcher(source);
			const expected = reference(source);
			const check = (input: string): void => {
				for (let index = 0; index <= input.length; index++) {
					assert.strictEqual(matcher.match(input, index), expected(input, index), `${source} on ${JSON.stringify(input)} at ${index}`);
				}
				if (input.length < maxLength) {
					for (const ch of alphabet) {
						check(input + ch);
					}
				}
			};
			check('');
		}

		test('the first alternative wins, not the longest', () => {
			const matcher = createEmojiMatcher('a|ab');
			assert.notStrictEqual(matcher.firstCodes, null);
			assert.strictEqual(matcher.match('ab', 0), 1);
			assertSame('a|ab', 'abc', 4);
			assertSame('ab|a', 'abc', 4);
			assertSame('a|ab|abc|b', 'abc', 5);
			assertSame('abc|a|ab', 'abc', 5);
		});

		test('groups', () => {
			assertSame('a(?:b|bc)c', 'abc', 5);
			assertSame('(?:a|ab)(?:c|bc)', 'abc', 5);
			assertSame('(?:a|ab)(?:c|bcd|b)d?', 'abcd', 6);
			assertSame('(a|b)(?:c(?:a|b)|a)|c', 'abc', 5);
		});

		test('character classes', () => {
			assertSame('[ab]c|[a-c][a-c]b', 'abcd', 5);
			assertSame('[#*0-9]\\ufe0f?\\u20e3', '#*5a️⃣', 4);
			assertSame('[\\u0061-\\u0063]\\*', 'abc*d', 3);
		});

		test('optional items are greedy', () => {
			assertSame('ab?b', 'abc', 5);
			assertSame('ab?(?:b|c)|abb', 'abc', 5);
			assertSame('a(?:bc)?b?c', 'abc', 6);
			assertSame('a[bc]?(?:c|b)?', 'abc', 5);
		});

		test('negative lookahead', () => {
			assertSame('a(?:b|(?!c))', 'abcd', 4);
			assertSame('a(?!b)|ab(?!c)', 'abcd', 4);
			assertSame('a(?!b)[bc]|ab', 'abcd', 4);
			assertSame('[ab](?:\\ufe0f|(?!\\ufe0e))', 'ab︎️c', 4);
			// a lookahead and no lookahead at the same string
			assertSame('a(?!b)|a', 'abc', 3);
			assertSame('ab|a(?!c)|a', 'abc', 3);
		});

		test('a syntax out of the subset falls back to the regexp', () => {
			for (const source of ['a+', 'a*b', 'a|', '(?=a)b', 'a{2}', '.', '[^a]', 'a??', '\\d', 'a(?!bc)', 'a(?!b)|a(?!c)', '(?<x>a)\\k<x>']) {
				const matcher = createEmojiMatcher(source);
				assert.strictEqual(matcher.firstCodes, null, source);
				assertSame(source, 'abc', 4);
			}
		});

		test('random regexps of the subset', () => {
			const next = random(3);
			const atom = (depth: number): string => {
				switch (next(depth > 0 ? 6 : 3)) {
					case 0: return 'abc'.charAt(next(3));
					case 1: return ['[ab]', '[bc]', '[a-c]'][next(3)];
					case 2: return 'abc'.charAt(next(3)) + '?';
					case 3: return `(?:${alternation(depth - 1)})`;
					case 4: return `(?:${alternation(depth - 1)})?`;
					default: return `(?!${['a', 'b', 'c', '[ab]'][next(4)]})`;
				}
			};
			const sequence = (depth: number): string => {
				let source = 'abc'.charAt(next(3));
				for (let count = next(4); count > 0; count--) {
					source += atom(depth);
				}
				return source;
			};
			const alternation = (depth: number): string => {
				const alts: string[] = [];
				for (let count = 1 + next(3); count > 0; count--) {
					alts.push(sequence(depth));
				}
				return alts.join('|');
			};
			let tries = 0;
			for (let i = 0; i < 1500; i++) {
				const source = alternation(2);
				if (createEmojiMatcher(source).firstCodes !== null) {
					tries++;
				}
				assertSame(source, 'abc', 6);
			}
			// most of them must be tested as a trie, not as the fallback
			assert.ok(tries > 1000, `${tries}`);
		});
	});
});
