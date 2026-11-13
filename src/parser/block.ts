//
// Block syntaxes: quote, code block, math block, center and search.
//

import { CENTER, CODE_BLOCK, MATH_BLOCK, QUOTE, SEARCH, TEXT } from '../node';
import type { MfmInline, MfmNode } from '../node';
import { BACKSLASH, BRACKET_CLOSE, BRACKET_OPEN, GT, isNewline, isSpace } from './chars';
import { atLineBegin, atLineEnd, skipNewline, useBudget } from './helpers';
import { scan, SPAN_CODE_BLOCK, SPAN_MATH_BLOCK } from './memo';
import { fullSeq, itemsThen, SYNTAX_CENTER } from './sequence';
import { FAIL, state } from './state';

export function quote(p: number): number {
	let q = skipNewline(skipNewline(p));
	if (!atLineBegin(q) || state.src.charCodeAt(q) !== GT) {
		return FAIL;
	}
	// lines that start with ">"
	let content = '';
	let lines = 0;
	for (;;) {
		let lineStart = q + 1;
		if (isSpace(state.src.charCodeAt(lineStart))) {
			lineStart++;
		}
		let lineEnd = lineStart;
		while (lineEnd < state.len && !isNewline(state.src.charCodeAt(lineEnd))) {
			lineEnd++;
		}
		const line = state.src.slice(lineStart, lineEnd);
		content = lines === 0 ? line : content + '\n' + line;
		lines++;
		q = lineEnd;
		const next = skipNewline(q);
		if (next === q || state.src.charCodeAt(next) !== GT) {
			break;
		}
		q = next;
	}
	q = skipNewline(skipNewline(q));
	// disallow empty content if single line
	if (lines === 1 && content.length === 0) {
		return FAIL;
	}
	// parse inner content
	let inner: MfmNode[];
	if (state.budget > 0 && state.depth + 1 < state.nestLimit) {
		state.budget--;
		const outerSrc = state.src;
		const outerLen = state.len;
		const outerMemo = state.memo;
		const outerInQuote = state.inQuote;
		state.src = content;
		state.len = content.length;
		state.memo = null;
		state.inQuote = true;
		state.foundEmojiAt = -1;
		state.depth++;
		inner = fullSeq();
		state.depth--;
		state.src = outerSrc;
		state.len = outerLen;
		state.memo = outerMemo;
		state.inQuote = outerInQuote;
		state.foundEmojiAt = -1;
	} else {
		// every character of the content tries to nest and ends up in a text
		useBudget(content.length);
		inner = [TEXT(content)];
	}
	state.node = QUOTE(inner);
	return q;
}

function findCodeBlockEnd(from: number): number {
	for (let p = from; p < state.len; p++) {
		if (isNewline(state.src.charCodeAt(p))) {
			const mark = skipNewline(p);
			if (state.src.startsWith('```', mark) && atLineEnd(mark + 3)) {
				return p;
			}
		}
	}
	return state.len;
}

export function codeBlock(p: number): number {
	let q = skipNewline(p);
	if (!atLineBegin(q) || !state.src.startsWith('```', q)) {
		return FAIL;
	}
	q += 3;
	const langStart = q;
	while (q < state.len && !isNewline(state.src.charCodeAt(q))) {
		q++;
	}
	if (q === state.len) {
		return FAIL;
	}
	const langEnd = q;
	const codeStart = skipNewline(q);
	const codeEnd = scan(SPAN_CODE_BLOCK, codeStart, findCodeBlockEnd);
	if (codeEnd === codeStart || codeEnd === state.len) {
		return FAIL;
	}
	// the closing mark is there because the scan stopped before it
	const end = skipNewline(skipNewline(codeEnd) + 3);
	const lang = state.src.slice(langStart, langEnd).trim();
	state.node = CODE_BLOCK(state.src.slice(codeStart, codeEnd), lang.length > 0 ? lang : null);
	return end;
}

function findMathBlockEnd(from: number): number {
	for (let p = from; p < state.len; p++) {
		const code = state.src.charCodeAt(p);
		if ((code === BACKSLASH || isNewline(code)) && state.src.startsWith('\\]', skipNewline(p))) {
			return p;
		}
	}
	return state.len;
}

export function mathBlock(p: number): number {
	let q = skipNewline(p);
	if (!atLineBegin(q) || !state.src.startsWith('\\[', q)) {
		return FAIL;
	}
	const formulaStart = skipNewline(q + 2);
	const formulaEnd = scan(SPAN_MATH_BLOCK, formulaStart, findMathBlockEnd);
	if (formulaEnd === formulaStart || formulaEnd === state.len) {
		return FAIL;
	}
	q = skipNewline(formulaEnd) + 2;
	if (!atLineEnd(q)) {
		return FAIL;
	}
	state.node = MATH_BLOCK(state.src.slice(formulaStart, formulaEnd));
	return skipNewline(q);
}

export function centerTag(p: number): number {
	const open = skipNewline(p);
	if (!atLineBegin(open) || !state.src.startsWith('<center>', open)) {
		return FAIL;
	}
	const end = itemsThen(SYNTAX_CENTER, skipNewline(open + 8));
	if (end !== FAIL) {
		state.node = CENTER(state.children as MfmInline[]);
	}
	return end;
}

export function centerTail(p: number): number {
	let q = skipNewline(p);
	if (!state.src.startsWith('</center>', q)) {
		return FAIL;
	}
	q += 9;
	if (!atLineEnd(q)) {
		return FAIL;
	}
	return skipNewline(q);
}

/** Returns the length of "search" or "検索" that ends at `end`, or 0. */
function searchWordLength(end: number): number {
	if (state.src.charCodeAt(end - 1) === 0x7d22 && state.src.charCodeAt(end - 2) === 0x691c) {
		return 2;
	}
	if (end >= 6
		&& (state.src.charCodeAt(end - 6) | 0x20) === 0x73
		&& (state.src.charCodeAt(end - 5) | 0x20) === 0x65
		&& (state.src.charCodeAt(end - 4) | 0x20) === 0x61
		&& (state.src.charCodeAt(end - 3) | 0x20) === 0x72
		&& (state.src.charCodeAt(end - 2) | 0x20) === 0x63
		&& (state.src.charCodeAt(end - 1) | 0x20) === 0x68) {
		return 6;
	}
	return 0;
}

export function search(p: number): number {
	const queryStart = skipNewline(p);
	if (!atLineBegin(queryStart)) {
		return FAIL;
	}
	let lineEnd = queryStart;
	while (lineEnd < state.len && !isNewline(state.src.charCodeAt(lineEnd))) {
		lineEnd++;
	}
	// The line ends with a space and a button. The button is "search" or "検索", which can be in "[]".
	let button: number;
	if (state.src.charCodeAt(lineEnd - 1) === BRACKET_CLOSE) {
		const word = searchWordLength(lineEnd - 1);
		if (word === 0 || state.src.charCodeAt(lineEnd - 2 - word) !== BRACKET_OPEN) {
			return FAIL;
		}
		button = word + 2;
	} else {
		button = searchWordLength(lineEnd);
		if (button === 0) {
			return FAIL;
		}
	}
	const queryEnd = lineEnd - button - 1;
	if (queryEnd <= queryStart || !isSpace(state.src.charCodeAt(queryEnd))) {
		return FAIL;
	}
	state.node = SEARCH(state.src.slice(queryStart, queryEnd), state.src.slice(queryStart, lineEnd));
	return skipNewline(lineEnd);
}
