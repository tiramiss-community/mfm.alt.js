//
// MFM parser.
//
// A hand-written recursive descent parser. Every syntax is a function that takes a position and returns
// the position after the syntax, or `FAIL`. The function leaves its node in `state.node`. A syntax that
// consumed the input as plain text leaves `null` there, and the caller makes text nodes out of the
// consumed ranges, so no string is made per character.
//
// The output is the same as mfm-js for any input. That includes the nest limit and the "nest budget" of
// mfm-js, which stops nesting on crafted inputs: `state.budget` is consumed at the same points as mfm-js does.
//
// modules:
// - state.ts    the state shared by the syntaxes
// - chars.ts    character codes and character classes
// - memo.ts     memos per input that bound the time on crafted inputs
// - helpers.ts  small helpers on the input
// - sequence.ts sequences of items: the whole input, the content of an inline syntax, and so on
// - dispatch.ts chooses the syntax to try by the character at the position
// - block.ts    block syntaxes: quote, code block, math block, center, search
// - inline.ts   inline syntaxes: emoji, bold, italic, code, math, plain, fn
// - link.ts     inline syntaxes that make references: mention, hashtag, url, link
//

import type { MfmNode, MfmSimpleNode } from '../node';
import { prepareChars } from './chars';
import { fullSeq, simpleSeq } from './sequence';
import { state } from './state';

/**
 * @param nestBudget for tests. how many times nesting can be tried
*/
export function fullParser(input: string, opts: { nestLimit?: number, nestBudget?: number }): MfmNode[] {
	prepareChars();
	state.reset(input);
	state.nestLimit = opts.nestLimit ?? 20;
	// normal input uses at most about 4 per character
	state.budget = opts.nestBudget ?? (input.length * 20 + 1000);
	try {
		return fullSeq();
	} finally {
		state.reset('');
	}
}

export function simpleParser(input: string): MfmSimpleNode[] {
	prepareChars();
	state.reset(input);
	try {
		return simpleSeq();
	} finally {
		state.reset('');
	}
}
