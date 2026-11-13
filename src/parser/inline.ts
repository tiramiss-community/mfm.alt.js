//
// Inline syntaxes: unicode emoji, emoji code, bold and italic words, plain, fn, inline code and math.
//

import { BOLD, EMOJI_CODE, FN, INLINE_CODE, ITALIC, MATH_INLINE, PLAIN, TEXT, UNI_EMOJI } from '../node';
import type { MfmFn, MfmInline } from '../node';
import { A_EMOJI_CODE, A_FN_NAME, ACUTE, ascii, BACKSLASH, BACKTICK, BRACKET_CLOSE, COLON, COMMA, DOT, EQUAL, isAlnum, isNewline, isSpace, LT, matchEmoji, PAREN_CLOSE, PAREN_OPEN, SPACE, UNDERSCORE, VARIATION_SELECTOR_16 } from './chars';
import { skipNewline } from './helpers';
import { mentionCharsEnd } from './link';
import { scan, SPAN_MATH_INLINE, SPAN_PLAIN } from './memo';
import { inlineItems } from './sequence';
import { FAIL, state } from './state';

export function unicodeEmoji(p: number): number {
	const end = p === state.foundEmojiAt ? state.foundEmojiEnd : matchEmoji(state.src, p);
	if (end === FAIL) {
		return FAIL;
	}
	// 異体字セレクタ(U+FE0F)の場合は文字として返す
	state.node = (end === p + 1 && state.src.charCodeAt(p) === VARIATION_SELECTOR_16) ? null : UNI_EMOJI(state.src.slice(p, end));
	return end;
}

export function emojiCode(p: number): number {
	let q = p + 1;
	for (;;) {
		const code = state.src.charCodeAt(q);
		if (!(code < 0x80 && (ascii[code] & A_EMOJI_CODE) !== 0)) {
			break;
		}
		q++;
	}
	if (q === p + 1 || state.src.charCodeAt(q) !== COLON) {
		return FAIL;
	}
	// the character after the closing mark is not an alphanumeric
	if (isAlnum(state.src.charCodeAt(q + 1))) {
		return FAIL;
	}
	state.node = EMOJI_CODE(state.src.slice(p + 1, q));
	return q + 1;
}

/** `__word__`, where the word is alphanumerics and spaces */
export function boldUnder(p: number): number {
	if (state.src.charCodeAt(p + 1) !== UNDERSCORE) {
		return FAIL;
	}
	const end = wordEnd(p + 2);
	if (end === p + 2 || state.src.charCodeAt(end) !== UNDERSCORE || state.src.charCodeAt(end + 1) !== UNDERSCORE) {
		return FAIL;
	}
	state.node = BOLD([TEXT(state.src.slice(p + 2, end))]);
	return end + 2;
}

/** `*word*` or `_word_`, where the word is alphanumerics and spaces */
export function italicWord(p: number, mark: number): number {
	const end = wordEnd(p + 1);
	if (end === p + 1 || state.src.charCodeAt(end) !== mark) {
		return FAIL;
	}
	// check before
	if (isAlnum(state.src.charCodeAt(p - 1))) {
		return FAIL;
	}
	state.node = ITALIC([TEXT(state.src.slice(p + 1, end))]);
	return end + 1;
}

function wordEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = state.src.charCodeAt(p);
		if (!isAlnum(code) && !isSpace(code)) {
			return p;
		}
		p++;
	}
}

function findPlainEnd(from: number): number {
	for (let p = from; p < state.len; p++) {
		const code = state.src.charCodeAt(p);
		if ((code === LT || isNewline(code)) && state.src.startsWith('</plain>', skipNewline(p))) {
			return p;
		}
	}
	return state.len;
}

export function plainTag(p: number): number {
	if (!state.src.startsWith('<plain>', p)) {
		return FAIL;
	}
	const textStart = skipNewline(p + 7);
	const textEnd = scan(SPAN_PLAIN, textStart, findPlainEnd);
	if (textEnd === textStart || textEnd === state.len) {
		return FAIL;
	}
	state.node = PLAIN(state.src.slice(textStart, textEnd));
	return skipNewline(textEnd) + 8;
}

function fnNameEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = state.src.charCodeAt(p);
		if (!(code < 0x80 && (ascii[code] & A_FN_NAME) !== 0)) {
			return p;
		}
		p++;
	}
}

/** `$[name.args content]`. The position must be at "$[". */
export function fn(p: number): number {
	state.node = null;
	const nameStart = p + 2;
	let q = fnNameEnd(nameStart);
	if (q === nameStart) {
		return q;
	}
	const name = state.src.slice(nameStart, q);
	let args: MfmFn['props']['args'] = {};
	if (state.src.charCodeAt(q) === DOT) {
		// ".key=value,key"
		const parsed: MfmFn['props']['args'] = {};
		let argStart = q + 1;
		let argsEnd = FAIL;
		for (;;) {
			const keyEnd = fnNameEnd(argStart);
			if (keyEnd === argStart) {
				break;
			}
			const key = state.src.slice(argStart, keyEnd);
			argsEnd = keyEnd;
			let value: string | true = true;
			if (state.src.charCodeAt(keyEnd) === EQUAL) {
				// [a-z0-9_.-]+
				const valueEnd = mentionCharsEnd(keyEnd + 1);
				if (valueEnd > keyEnd + 1) {
					value = state.src.slice(keyEnd + 1, valueEnd);
					argsEnd = valueEnd;
				}
			}
			parsed[key] = value;
			if (state.src.charCodeAt(argsEnd) !== COMMA) {
				break;
			}
			argStart = argsEnd + 1;
		}
		if (argsEnd !== FAIL) {
			args = parsed;
			q = argsEnd;
		}
	}
	if (state.src.charCodeAt(q) !== SPACE) {
		return q;
	}
	const contentStart = q + 1;
	const contentEnd = inlineItems(contentStart, ']', false);
	state.node = null;
	if (contentEnd === contentStart || state.src.charCodeAt(contentEnd) !== BRACKET_CLOSE) {
		return contentEnd;
	}
	state.node = FN(name, args, state.children as MfmInline[]);
	return contentEnd + 1;
}

export function inlineCode(p: number): number {
	let q = p + 1;
	for (; q < state.len; q++) {
		const code = state.src.charCodeAt(q);
		if (code === BACKTICK || code === ACUTE || isNewline(code)) {
			break;
		}
	}
	if (q === p + 1 || state.src.charCodeAt(q) !== BACKTICK) {
		return FAIL;
	}
	state.node = INLINE_CODE(state.src.slice(p + 1, q));
	return q + 1;
}

function findMathInlineEnd(from: number): number {
	for (let p = from; p < state.len; p++) {
		const code = state.src.charCodeAt(p);
		if (isNewline(code) || (code === BACKSLASH && state.src.charCodeAt(p + 1) === PAREN_CLOSE)) {
			return p;
		}
	}
	return state.len;
}

export function mathInline(p: number): number {
	if (state.src.charCodeAt(p + 1) !== PAREN_OPEN) {
		return FAIL;
	}
	const start = p + 2;
	const end = scan(SPAN_MATH_INLINE, start, findMathInlineEnd);
	if (end === start || state.src.charCodeAt(end) !== BACKSLASH) {
		return FAIL;
	}
	state.node = MATH_INLINE(state.src.slice(start, end));
	return end + 2;
}
