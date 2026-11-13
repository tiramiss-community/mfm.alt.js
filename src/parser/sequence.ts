//
// Sequences of items: the whole input (full and simple), the content of an inline syntax, and the
// items of `<center>` and of a link label, which remember the positions that lead to a failure.
//

import type { MfmNode, MfmSimpleNode } from '../node';
import { centerTail } from './block';
import { BRACKET_CLOSE, COLON, isNewline, K_EMOJI, K_SIMPLE_SPECIAL, kinds, LT } from './chars';
import { full, inline } from './dispatch';
import { pushText, skipNewline, textRunEnd, useBudget } from './helpers';
import { emojiCode, plainTag, unicodeEmoji } from './inline';
import { linkTail } from './link';
import { getMemo } from './memo';
import { FAIL, state } from './state';

/** Parses the whole input with the full syntax. */
export function fullSeq(): MfmNode[] {
	const out: MfmNode[] = [];
	let p = 0;
	let textStart = 0;
	while (p < state.len) {
		const end = full(p);
		if (state.node !== null) {
			pushText(out, textStart, p);
			out.push(state.node);
			textStart = end;
			p = end;
			continue;
		}
		p = end;
		// A search can start at the beginning of a line, even with a plain character.
		if (!isNewline(state.src.charCodeAt(p - 1))) {
			p = textRunEnd(p);
		}
	}
	pushText(out, textStart, p);
	return out;
}

/** Parses the whole input with the simple syntax. */
export function simpleSeq(): MfmSimpleNode[] {
	const out: MfmNode[] = [];
	let p = 0;
	let textStart = 0;
	while (p < state.len) {
		const code = state.src.charCodeAt(p);
		const kind = kinds[code];
		let end = FAIL;
		if ((kind & K_SIMPLE_SPECIAL) !== 0) {
			if ((kind & K_EMOJI) !== 0) {
				end = unicodeEmoji(p);
			}
			if (end === FAIL && code === COLON) {
				end = emojiCode(p);
			}
			if (end === FAIL && code === LT) {
				// to NOT parse emojiCode inside `<plain>`
				end = plainTag(p);
			}
		}
		if (end === FAIL) {
			p++;
			continue;
		}
		if (state.node !== null) {
			pushText(out, textStart, p);
			out.push(state.node);
			textStart = end;
		}
		p = end;
	}
	pushText(out, textStart, p);
	return out as MfmSimpleNode[];
}

/** Parses an inline item one level deeper. Returns a character as a text when it cannot nest. */
function nestInline(p: number): number {
	if (state.budget > 0) {
		state.budget--;
		if (state.depth + 1 < state.nestLimit) {
			state.depth++;
			const end = inline(p);
			state.depth--;
			return end;
		}
	}
	state.node = null;
	return p + 1;
}

/**
 * Parses inline items until `close`, a newline if `stopAtNewline`, or the end of the input.
 * Leaves the items in `children` and returns where it stopped.
*/
export function inlineItems(start: number, close: string, stopAtNewline: boolean): number {
	const closeCode = close.charCodeAt(0);
	const closeIsOneChar = close.length === 1;
	const out: MfmNode[] = [];
	let p = start;
	let textStart = start;
	while (p < state.len) {
		// A run of plain characters. Each of them is an item, which tries to nest and ends up in a text.
		const runEnd = textRunEnd(p);
		if (runEnd > p) {
			useBudget(runEnd - p);
			p = runEnd;
			continue;
		}
		const code = state.src.charCodeAt(p);
		if (code === closeCode && (closeIsOneChar || state.src.startsWith(close, p))) {
			break;
		}
		if (stopAtNewline && isNewline(code)) {
			break;
		}
		const end = nestInline(p);
		if (state.node !== null) {
			pushText(out, textStart, p);
			out.push(state.node);
			textStart = end;
		}
		p = end;
	}
	pushText(out, textStart, p);
	state.children = out;
	return p;
}

/**
 * Parses inline items between an opening mark and `close`. The position must be at the opening mark.
 * When the items or the closing mark are missing, what has been read is a text, and `closed` is false.
*/
export function enclosed(p: number, openLength: number, close: string, stopAtNewline: boolean): number {
	const start = p + openLength;
	const stop = inlineItems(start, close, stopAtNewline);
	state.node = null;
	if (stop > start && state.src.startsWith(close, stop)) {
		state.closed = true;
		return stop + close.length;
	}
	state.closed = false;
	return stop;
}

export const SYNTAX_CENTER = 0;
export const SYNTAX_LINK = 1;

/**
 * Parses inline items and then the tail of the syntax: the items of `<center>` or the label of a link.
 * The positions that the items were read from are remembered when it fails, because the same failure
 * comes after reading from any of them again.
*/
export function itemsThen(syntax: number, start: number): number {
	const isLink = syntax === SYNTAX_LINK;
	const memoOfInput = getMemo();
	const key = (state.depth * 2 + (state.linkLabel ? 1 : 0)) * 2 + syntax;
	let failed = memoOfInput.failed?.get(key);
	// The positions of the items. A run of plain characters is a pair of (~start, end).
	const bounds: number[] = [];
	const out: MfmNode[] = [];
	let p = start;
	let textStart = start;
	while (failed === undefined || failed[p] === 0) {
		if (p >= state.len) {
			bounds.push(p);
			break;
		}
		let runEnd = textRunEnd(p);
		if (runEnd > p) {
			// every character of the run is an item, so the run ends before a position that is known to fail
			if (failed !== undefined) {
				for (let q = p + 1; q < runEnd; q++) {
					if (failed[q] !== 0) {
						runEnd = q;
						break;
					}
				}
			}
			bounds.push(~p, runEnd);
			useBudget(runEnd - p);
			p = runEnd;
			continue;
		}
		const code = state.src.charCodeAt(p);
		bounds.push(p);
		if (isLink) {
			if (code === BRACKET_CLOSE || isNewline(code)) {
				break;
			}
		} else {
			if ((code === LT || isNewline(code)) && state.src.startsWith('</center>', skipNewline(p))) {
				break;
			}
		}
		let end: number;
		if (!isLink) {
			end = nestInline(p);
		} else if (state.budget > 0 && (state.budget--, state.depth + 1 < state.nestLimit)) {
			state.depth++;
			state.linkLabel = true;
			end = inline(p);
			state.linkLabel = false;
			state.depth--;
		} else {
			state.node = null;
			end = p + 1;
		}
		if (state.node !== null) {
			pushText(out, textStart, p);
			out.push(state.node);
			textStart = end;
		}
		p = end;
	}
	if (p === start) {
		return FAIL;
	}
	failed = memoOfInput.failed?.get(key);
	let end = FAIL;
	if (failed === undefined || failed[p] === 0) {
		end = isLink ? linkTail(p) : centerTail(p);
	}
	if (end === FAIL) {
		if (failed === undefined) {
			failed = new Uint8Array(state.len + 1);
			memoOfInput.failed ??= new Map();
			memoOfInput.failed.set(key, failed);
		}
		for (let i = 0; i < bounds.length; i++) {
			const bound = bounds[i];
			if (bound >= 0) {
				failed[bound] = 1;
			} else {
				failed.fill(1, ~bound, bounds[++i]);
			}
		}
		return FAIL;
	}
	pushText(out, textStart, p);
	state.children = out;
	return end;
}
