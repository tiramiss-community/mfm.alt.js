//
// Small helpers on the input: newlines, line boundaries, the nest budget and runs of plain text.
//

import { TEXT } from '../node';
import type { MfmNode } from '../node';
import { CR, isNewline, K_SPECIAL, K_SYNTAX, kinds, LF, LOWER_H, matchEmoji } from './chars';
import { FAIL, state } from './state';

/** Returns the position after the newline at the position, or the position itself. */
export function skipNewline(p: number): number {
	const code = state.src.charCodeAt(p);
	if (code === CR) {
		return state.src.charCodeAt(p + 1) === LF ? p + 2 : p + 1;
	}
	if (code === LF) {
		return p + 1;
	}
	return p;
}

export function atLineBegin(p: number): boolean {
	return p === 0 || isNewline(state.src.charCodeAt(p - 1));
}

export function atLineEnd(p: number): boolean {
	return p === state.len || isNewline(state.src.charCodeAt(p));
}

/** Uses the budget for `count` tries of nesting. */
export function useBudget(count: number): void {
	state.budget = state.budget > count ? state.budget - count : 0;
}

/**
 * Returns the end of the run of the characters at which nothing but a text can start,
 * as long as the position is not the beginning of a line (see `search`).
*/
export function textRunEnd(start: number): number {
	let p = start;
	while (p < state.len) {
		const code = state.src.charCodeAt(p);
		const kind = kinds[code];
		if ((kind & K_SPECIAL) !== 0) {
			if (code === LOWER_H) {
				// "h" is special only for "http"
				if (state.src.charCodeAt(p + 1) === 0x74) {
					break;
				}
			} else if ((kind & K_SYNTAX) === 0) {
				// only an emoji can start here. digits come here for keycap emojis
				const end = matchEmoji(state.src, p);
				if (end !== FAIL) {
					state.foundEmojiAt = p;
					state.foundEmojiEnd = end;
					break;
				}
			} else {
				break;
			}
		}
		p++;
	}
	return p;
}

export function pushText(out: MfmNode[], start: number, end: number): void {
	if (start < end) {
		out.push(TEXT(state.src.slice(start, end)));
	}
}
