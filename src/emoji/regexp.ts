//
// A parser for the subset of the regexp syntax that `emojiRegex` uses: alternatives, groups, character
// classes, `?` and a negative lookahead of one code unit. Anything else throws `UnsupportedSyntax`.
//

/** `optional` is the `?` quantifier. */
export type Item =
	/** one code unit out of the set */
	| { type: 'set', set: number[], optional: boolean }
	/** one of the alternatives */
	| { type: 'group', alts: Item[][], optional: boolean }
	/** a negative lookahead: the next code unit is not in the set */
	| { type: 'notNext', set: number[], optional: false };

export class UnsupportedSyntax extends Error { }

function isAsciiAlnum(code: number): boolean {
	return (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

export function parseRegexpSource(source: string): Item[][] {
	let at = 0;
	// The same items appear many times, such as `\ud83d` and `\u200d`. They are shared to save memory,
	// which is safe because nothing changes an item after the parsing.
	const shared = new Map<string, Item>();

	function share(item: Item): Item {
		if (item.type === 'group') {
			return item;
		}
		const key = `${item.type}${item.optional ? '?' : ''}${item.set.join(',')}`;
		const found = shared.get(key);
		if (found !== undefined) {
			return found;
		}
		shared.set(key, item);
		return item;
	}

	function hexDigit(index: number): number {
		const code = source.charCodeAt(index);
		if (code >= 0x30 && code <= 0x39) return code - 0x30;
		if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
		if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
		throw new UnsupportedSyntax();
	}

	function unit(inClass: boolean): number {
		const code = source.charCodeAt(at);
		if (code === 0x5c) { // "\"
			const escaped = source.charCodeAt(at + 1);
			if (escaped === 0x75) { // "u"
				const value = (hexDigit(at + 2) << 12) | (hexDigit(at + 3) << 8) | (hexDigit(at + 4) << 4) | hexDigit(at + 5);
				at += 6;
				return value;
			}
			// an escaped punctuation such as `\*`
			if (escaped < 0x80 && !isAsciiAlnum(escaped)) {
				at += 2;
				return escaped;
			}
			throw new UnsupportedSyntax();
		}
		if (at >= source.length || (!inClass && '()[]{}|?*+.^$'.includes(source.charAt(at)))) {
			throw new UnsupportedSyntax();
		}
		at++;
		return code;
	}

	function charClass(): number[] {
		at++; // "["
		if (source.charAt(at) === '^') {
			throw new UnsupportedSyntax();
		}
		const set: number[] = [];
		while (source.charAt(at) !== ']') {
			const from = unit(true);
			let to = from;
			if (source.charAt(at) === '-' && source.charAt(at + 1) !== ']') {
				at++;
				to = unit(true);
			}
			for (let code = from; code <= to; code++) {
				set.push(code);
			}
		}
		at++; // "]"
		return set;
	}

	function alternation(): Item[][] {
		const alts: Item[][] = [[]];
		while (at < source.length && source.charAt(at) !== ')') {
			const ch = source.charAt(at);
			if (ch === '|') {
				at++;
				alts.push([]);
				continue;
			}
			let item: Item;
			if (ch === '(') {
				const lookahead = source.startsWith('(?!', at);
				if (lookahead || source.startsWith('(?:', at)) {
					at += 3;
				} else if (source.charAt(at + 1) !== '?') {
					// a capturing group. it works as a plain group because back references are not supported
					at += 1;
				} else {
					throw new UnsupportedSyntax();
				}
				const inner = alternation();
				if (source.charAt(at) !== ')') {
					throw new UnsupportedSyntax();
				}
				at++;
				if (lookahead) {
					// only a lookahead of one code unit is supported
					const notNext: number[] = [];
					for (const alt of inner) {
						const only = alt.length === 1 ? alt[0] : null;
						if (only === null || only.type !== 'set' || only.optional) {
							throw new UnsupportedSyntax();
						}
						notNext.push(...only.set);
					}
					item = { type: 'notNext', set: notNext, optional: false };
				} else {
					item = { type: 'group', alts: inner, optional: false };
				}
			} else if (ch === '[') {
				item = { type: 'set', set: charClass(), optional: false };
			} else {
				item = { type: 'set', set: [unit(false)], optional: false };
			}
			if (source.charAt(at) === '?') {
				at++;
				// a lazy quantifier changes the priority
				if (source.charAt(at) === '?' || item.type === 'notNext') {
					throw new UnsupportedSyntax();
				}
				item.optional = true;
			}
			alts[alts.length - 1].push(share(item));
		}
		return alts;
	}

	const alts = alternation();
	if (at !== source.length) {
		throw new UnsupportedSyntax();
	}
	return alts;
}
