//
// Unicode emoji matcher.
//
// mfm-js matches `emojiRegex` of @misskey-dev/emoji-data at a position. The regexp is one large alternation,
// which a regexp engine tries one by one. Here the same regexp is compiled into a trie, and matching walks
// the trie along the input. The result is the same as the regexp for any input.
//
// modules:
// - regexp.ts parses the source of the regexp
// - trie.ts   builds the trie from it, and matches an input with the trie
//

import { emojiRegex } from '@misskey-dev/emoji-data';
import { parseRegexpSource, UnsupportedSyntax } from './regexp';
import { Trie, trieMatch } from './trie';

export type EmojiMatcher = {
	/** Returns the end of the emoji that starts at `index`, or -1. */
	match: (input: string, index: number) => number;
	/** The code units that an emoji can start with. `null` when they are unknown. */
	firstCodes: number[] | null;
};

function regexpMatch(source: string): EmojiMatcher['match'] {
	const re = new RegExp(source, 'y');
	return (input, index) => {
		re.lastIndex = index;
		return re.test(input) ? re.lastIndex : -1;
	};
}

export function createEmojiMatcher(source: string): EmojiMatcher {
	let trie: Trie;
	try {
		trie = new Trie(parseRegexpSource(source));
	} catch (err) {
		if (err instanceof UnsupportedSyntax) {
			// The regexp uses a syntax that is not expected. Matching it as is keeps the result right, though slower.
			return { match: regexpMatch(source), firstCodes: null };
		}
		throw err;
	}
	let fallback: EmojiMatcher['match'] | null = null;
	return {
		match: (input, index) => {
			if (fallback !== null) {
				return fallback(input, index);
			}
			try {
				return trieMatch(trie, input, index);
			} catch (err) {
				if (err instanceof UnsupportedSyntax) {
					// found while expanding a node
					fallback = regexpMatch(source);
					return fallback(input, index);
				}
				throw err;
			}
		},
		firstCodes: trie.root.childCodes(),
	};
}

let matcher: EmojiMatcher | null = null;

export function emojiMatcher(): EmojiMatcher {
	matcher ??= createEmojiMatcher(emojiRegex.source);
	return matcher;
}
