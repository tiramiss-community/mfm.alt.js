//
// MFM parser.
//
// A hand-written recursive descent parser. Every syntax is a function that takes a position and returns
// the position after the syntax, or `FAIL`. The function leaves its node in `node`. A syntax that
// consumed the input as plain text leaves `null` there, and the caller makes text nodes out of the
// consumed ranges, so no string is made per character.
//
// The output is the same as mfm-js for any input. That includes the nest limit and the "nest budget" of
// mfm-js, which stops nesting on crafted inputs: `budget` is consumed at the same points as mfm-js does.
//

import { emojiMatcher } from './emoji';
import {
	BOLD, CENTER, CODE_BLOCK, EMOJI_CODE, FN, HASHTAG, INLINE_CODE, ITALIC, LINK, MATH_BLOCK, MATH_INLINE, MENTION,
	N_URL, PLAIN, QUOTE, SEARCH, SMALL, STRIKE, TEXT, UNI_EMOJI,
} from './node';
import type { MfmFn, MfmInline, MfmNode, MfmSimpleNode, MfmUrl } from './node';

const FAIL = -1;

// ---- character codes ----

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const HASH = 0x23; // #
const DOLLAR = 0x24; // $
const PAREN_OPEN = 0x28; // (
const PAREN_CLOSE = 0x29; // )
const ASTERISK = 0x2a; // *
const COMMA = 0x2c; // ,
const DOT = 0x2e; // .
const COLON = 0x3a; // :
const LT = 0x3c; // <
const EQUAL = 0x3d; // =
const GT = 0x3e; // >
const QUESTION = 0x3f; // ?
const AT = 0x40; // @
const BRACKET_OPEN = 0x5b; // [
const BACKSLASH = 0x5c; // \
const BRACKET_CLOSE = 0x5d; // ]
const UNDERSCORE = 0x5f; // _
const BACKTICK = 0x60; // `
const LOWER_H = 0x68; // h
const TILDE = 0x7e; // ~
const ACUTE = 0xb4; // ´
const IDEOGRAPHIC_SPACE = 0x3000;
const VARIATION_SELECTOR_16 = 0xfe0f;

// ---- character classes ----

/** Something other than a text can start at the character in the full and the inline syntax. */
const K_SPECIAL = 1;
/** Same as K_SPECIAL, for the simple syntax. */
const K_SIMPLE_SPECIAL = 2;
/** An emoji can start with the code unit. */
const K_EMOJI = 4;
/** A syntax other than an emoji can start at the character in the full and the inline syntax. */
const K_SYNTAX = 8;

/** K_* flags of a code unit */
const kinds = new Uint8Array(0x10000);

// flags of an ascii character
const A_ALNUM = 1; // [a-z0-9]
const A_FN_NAME = 2; // [a-z0-9_]
const A_MENTION = 4; // [a-z0-9_.-]
const A_EMOJI_CODE = 8; // [a-z0-9_+-]
const A_URL = 16; // [.,a-z0-9_/:%#@$&?!~=+-]
const A_HASHTAG_STOP = 32; // the ascii characters that end a hashtag

const ascii = new Uint8Array(0x80);
for (let code = 0; code < 0x80; code++) {
	const ch = String.fromCharCode(code);
	let flags = 0;
	if (/[a-z0-9]/i.test(ch)) flags |= A_ALNUM;
	if (/[a-z0-9_]/i.test(ch)) flags |= A_FN_NAME;
	if (/[a-z0-9_.-]/i.test(ch)) flags |= A_MENTION;
	if (/[a-z0-9_+-]/i.test(ch)) flags |= A_EMOJI_CODE;
	if (/[.,a-z0-9_/:%#@$&?!~=+-]/i.test(ch)) flags |= A_URL;
	if (/[ \t.,!?'"#:/[\]()<>\r\n]/.test(ch)) flags |= A_HASHTAG_STOP;
	ascii[code] = flags;
}

function isNewline(code: number): boolean {
	return code === LF || code === CR;
}

function isSpace(code: number): boolean {
	return code === SPACE || code === IDEOGRAPHIC_SPACE || code === TAB;
}

function isAlnum(code: number): boolean {
	return code < 0x80 && (ascii[code] & A_ALNUM) !== 0;
}

function isHashtagChar(code: number): boolean {
	if (code < 0x80) {
		return (ascii[code] & A_HASHTAG_STOP) === 0;
	}
	switch (code) {
		case IDEOGRAPHIC_SPACE:
		case 0x3010: // 【
		case 0x3011: // 】
		case 0x300c: // 「
		case 0x300d: // 」
		case 0xff08: // （
		case 0xff09: // ）
			return false;
		default:
			// NaN (the end of the input) comes here too
			return code >= 0x80;
	}
}

function isUrlChar(code: number): boolean {
	return code < 0x80 && (ascii[code] & A_URL) !== 0;
}

// ---- state of a parsing ----

/** the input. inside a quote, it is the content of the quote */
let src = '';
let len = 0;
let nestLimit = 0;
let depth = 0;
/** how many times nesting can be tried any more. `Infinity` means no limit */
let budget = 0;
/** inside the label of a link, where mentions, hashtags, urls and links are not parsed */
let linkLabel = false;
/** the node of the syntax that matched last, or `null` when it should be a text */
let node: MfmNode | null = null;
/** the children of the syntax that matched last */
let children: MfmNode[] = [];
/** the url of `linkTail` that matched last */
let linkUrl = '';

let prepared = false;
let matchEmoji: (input: string, index: number) => number = () => FAIL;
/** The emoji that `textRunEnd` found last: its position in `src` and its end. */
let foundEmojiAt = -1;
let foundEmojiEnd = -1;

// ---- memos ----
//
// They bound the time on crafted inputs. `spans` does not change the result. `failed` does, when the
// budget runs out, so it is kept the same as the memo of mfm-js.

const SPAN_CODE_BLOCK = 0;
const SPAN_MATH_BLOCK = 1;
const SPAN_PLAIN = 2;
const SPAN_MATH_INLINE = 3;
const SPAN_URL_ALT = 4;

class InputMemo {
	/**
	 * The last scanned range per SPAN_*, as [start, end] pairs.
	 * A scan that starts inside the range ends at the same position.
	*/
	spans: number[] = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
	/**
	 * The positions from which `itemsThen` cannot succeed.
	 * The key is made of the syntax and the state that the result depends on.
	*/
	failed: Map<number, Uint8Array> | null = null;
}

/** the memo of `src`. made when it is needed */
let memo: InputMemo | null = null;
/** the memos of the contents of quotes. contents of the same string share a memo */
let quoteMemos: Map<string, InputMemo> | null = null;
let inQuote = false;

function getMemo(): InputMemo {
	if (memo !== null) {
		return memo;
	}
	if (!inQuote) {
		memo = new InputMemo();
		return memo;
	}
	quoteMemos ??= new Map();
	let found = quoteMemos.get(src);
	if (found === undefined) {
		found = new InputMemo();
		quoteMemos.set(src, found);
	}
	memo = found;
	return found;
}

function scan(span: number, start: number, find: (from: number) => number): number {
	const spans = getMemo().spans;
	if (spans[span * 2] <= start && start <= spans[span * 2 + 1]) {
		return spans[span * 2 + 1];
	}
	const end = find(start);
	spans[span * 2] = start;
	spans[span * 2 + 1] = end;
	return end;
}

// ---- helpers ----

/** Returns the position after the newline at the position, or the position itself. */
function skipNewline(p: number): number {
	const code = src.charCodeAt(p);
	if (code === CR) {
		return src.charCodeAt(p + 1) === LF ? p + 2 : p + 1;
	}
	if (code === LF) {
		return p + 1;
	}
	return p;
}

function atLineBegin(p: number): boolean {
	return p === 0 || isNewline(src.charCodeAt(p - 1));
}

function atLineEnd(p: number): boolean {
	return p === len || isNewline(src.charCodeAt(p));
}

/** Uses the budget for `count` tries of nesting. */
function useBudget(count: number): void {
	budget = budget > count ? budget - count : 0;
}

/**
 * Returns the end of the run of the characters at which nothing but a text can start,
 * as long as the position is not the beginning of a line (see `search`).
*/
function textRunEnd(start: number): number {
	let p = start;
	while (p < len) {
		const code = src.charCodeAt(p);
		const kind = kinds[code];
		if ((kind & K_SPECIAL) !== 0) {
			if (code === LOWER_H) {
				// "h" is special only for "http"
				if (src.charCodeAt(p + 1) === 0x74) {
					break;
				}
			} else if ((kind & K_SYNTAX) === 0) {
				// only an emoji can start here. digits come here for keycap emojis
				const end = matchEmoji(src, p);
				if (end !== FAIL) {
					foundEmojiAt = p;
					foundEmojiEnd = end;
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

function pushText(out: MfmNode[], start: number, end: number): void {
	if (start < end) {
		out.push(TEXT(src.slice(start, end)));
	}
}

// ---- sequences ----

/** Parses the whole input with the full syntax. */
function fullSeq(): MfmNode[] {
	const out: MfmNode[] = [];
	let p = 0;
	let textStart = 0;
	while (p < len) {
		const end = full(p);
		if (node !== null) {
			pushText(out, textStart, p);
			out.push(node);
			textStart = end;
			p = end;
			continue;
		}
		p = end;
		// A search can start at the beginning of a line, even with a plain character.
		if (!isNewline(src.charCodeAt(p - 1))) {
			p = textRunEnd(p);
		}
	}
	pushText(out, textStart, p);
	return out;
}

/** Parses the whole input with the simple syntax. */
function simpleSeq(): MfmSimpleNode[] {
	const out: MfmNode[] = [];
	let p = 0;
	let textStart = 0;
	while (p < len) {
		const code = src.charCodeAt(p);
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
		if (node !== null) {
			pushText(out, textStart, p);
			out.push(node);
			textStart = end;
		}
		p = end;
	}
	pushText(out, textStart, p);
	return out as MfmSimpleNode[];
}

/** Parses an inline item one level deeper. Returns a character as a text when it cannot nest. */
function nestInline(p: number): number {
	if (budget > 0) {
		budget--;
		if (depth + 1 < nestLimit) {
			depth++;
			const end = inline(p);
			depth--;
			return end;
		}
	}
	node = null;
	return p + 1;
}

/**
 * Parses inline items until `close`, a newline if `stopAtNewline`, or the end of the input.
 * Leaves the items in `children` and returns where it stopped.
*/
function inlineItems(start: number, close: string, stopAtNewline: boolean): number {
	const closeCode = close.charCodeAt(0);
	const closeIsOneChar = close.length === 1;
	const out: MfmNode[] = [];
	let p = start;
	let textStart = start;
	while (p < len) {
		// A run of plain characters. Each of them is an item, which tries to nest and ends up in a text.
		const runEnd = textRunEnd(p);
		if (runEnd > p) {
			useBudget(runEnd - p);
			p = runEnd;
			continue;
		}
		const code = src.charCodeAt(p);
		if (code === closeCode && (closeIsOneChar || src.startsWith(close, p))) {
			break;
		}
		if (stopAtNewline && isNewline(code)) {
			break;
		}
		const end = nestInline(p);
		if (node !== null) {
			pushText(out, textStart, p);
			out.push(node);
			textStart = end;
		}
		p = end;
	}
	pushText(out, textStart, p);
	children = out;
	return p;
}

/** `enclosed` found the closing mark */
let closed = false;

/**
 * Parses inline items between an opening mark and `close`. The position must be at the opening mark.
 * When the items or the closing mark are missing, what has been read is a text, and `closed` is false.
*/
function enclosed(p: number, openLength: number, close: string, stopAtNewline: boolean): number {
	const start = p + openLength;
	const stop = inlineItems(start, close, stopAtNewline);
	node = null;
	if (stop > start && src.startsWith(close, stop)) {
		closed = true;
		return stop + close.length;
	}
	closed = false;
	return stop;
}

const SYNTAX_CENTER = 0;
const SYNTAX_LINK = 1;

/**
 * Parses inline items and then the tail of the syntax: the items of `<center>` or the label of a link.
 * The positions that the items were read from are remembered when it fails, because the same failure
 * comes after reading from any of them again.
*/
function itemsThen(syntax: number, start: number): number {
	const isLink = syntax === SYNTAX_LINK;
	const memoOfInput = getMemo();
	const key = (depth * 2 + (linkLabel ? 1 : 0)) * 2 + syntax;
	let failed = memoOfInput.failed?.get(key);
	// The positions of the items. A run of plain characters is a pair of (~start, end).
	const bounds: number[] = [];
	const out: MfmNode[] = [];
	let p = start;
	let textStart = start;
	while (failed === undefined || failed[p] === 0) {
		if (p >= len) {
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
		const code = src.charCodeAt(p);
		bounds.push(p);
		if (isLink) {
			if (code === BRACKET_CLOSE || isNewline(code)) {
				break;
			}
		} else {
			if ((code === LT || isNewline(code)) && src.startsWith('</center>', skipNewline(p))) {
				break;
			}
		}
		let end: number;
		if (!isLink) {
			end = nestInline(p);
		} else if (budget > 0 && (budget--, depth + 1 < nestLimit)) {
			depth++;
			linkLabel = true;
			end = inline(p);
			linkLabel = false;
			depth--;
		} else {
			node = null;
			end = p + 1;
		}
		if (node !== null) {
			pushText(out, textStart, p);
			out.push(node);
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
			failed = new Uint8Array(len + 1);
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
	children = out;
	return end;
}

// ---- syntaxes: dispatch ----

function full(p: number): number {
	const code = src.charCodeAt(p);
	const kind = kinds[code];
	let end: number;
	if ((kind & K_SPECIAL) !== 0) {
		if ((kind & K_EMOJI) !== 0) {
			end = unicodeEmoji(p);
			if (end !== FAIL) return end;
		}
		switch (code) {
			case CR:
			case LF:
				end = centerTag(p);
				if (end !== FAIL) return end;
				end = codeBlock(p);
				if (end !== FAIL) return end;
				end = quote(p);
				if (end !== FAIL) return end;
				end = mathBlock(p);
				if (end !== FAIL) return end;
				break;
			case LT:
				end = centerTag(p);
				if (end !== FAIL) return end;
				end = inlineSyntax(p, code);
				if (end !== FAIL) return end;
				break;
			case BACKTICK:
				end = codeBlock(p);
				if (end !== FAIL) return end;
				end = inlineCode(p);
				if (end !== FAIL) return end;
				break;
			case GT:
				end = quote(p);
				if (end !== FAIL) return end;
				break;
			case BACKSLASH:
				end = mathBlock(p);
				if (end !== FAIL) return end;
				end = mathInline(p);
				if (end !== FAIL) return end;
				break;
			default:
				end = inlineSyntax(p, code);
				if (end !== FAIL) return end;
				break;
		}
	}
	end = search(p);
	if (end !== FAIL) return end;
	node = null;
	return p + 1;
}

/** Parses an inline item. The position must be inside the input. */
function inline(p: number): number {
	const code = src.charCodeAt(p);
	const kind = kinds[code];
	if ((kind & K_SPECIAL) !== 0) {
		let end: number;
		if ((kind & K_EMOJI) !== 0) {
			end = unicodeEmoji(p);
			if (end !== FAIL) return end;
		}
		end = inlineSyntax(p, code);
		if (end !== FAIL) return end;
	}
	node = null;
	return p + 1;
}

/** Parses an inline syntax other than an emoji and a text. */
function inlineSyntax(p: number, code: number): number {
	let end: number;
	switch (code) {
		case LT:
			switch (src.charCodeAt(p + 1)) {
				case 0x73: // s
					if (src.startsWith('<small>', p)) {
						end = enclosed(p, 7, '</small>', false);
						if (closed) node = SMALL(children as MfmInline[]);
						return end;
					}
					if (src.startsWith('<s>', p)) {
						end = enclosed(p, 3, '</s>', false);
						if (closed) node = STRIKE(children as MfmInline[]);
						return end;
					}
					return FAIL;
				case 0x70: // p
					return plainTag(p);
				case 0x62: // b
					if (src.startsWith('<b>', p)) {
						end = enclosed(p, 3, '</b>', false);
						if (closed) node = BOLD(children as MfmInline[]);
						return end;
					}
					return FAIL;
				case 0x69: // i
					if (src.startsWith('<i>', p)) {
						end = enclosed(p, 3, '</i>', false);
						if (closed) node = ITALIC(children as MfmInline[]);
						return end;
					}
					return FAIL;
				case LOWER_H:
					return urlAlt(p);
				default:
					return FAIL;
			}
		case ASTERISK:
			if (src.charCodeAt(p + 1) === ASTERISK) {
				if (src.charCodeAt(p + 2) === ASTERISK) {
					end = enclosed(p, 3, '***', false);
					if (closed) node = FN('tada', {}, children as MfmInline[]);
					return end;
				}
				end = enclosed(p, 2, '**', false);
				if (closed) node = BOLD(children as MfmInline[]);
				return end;
			}
			return italicWord(p, ASTERISK);
		case UNDERSCORE:
			end = boldUnder(p);
			if (end !== FAIL) return end;
			return italicWord(p, UNDERSCORE);
		case BACKTICK:
			return inlineCode(p);
		case BACKSLASH:
			return mathInline(p);
		case TILDE:
			if (src.charCodeAt(p + 1) === TILDE) {
				end = enclosed(p, 2, '~~', true);
				if (closed) node = STRIKE(children as MfmInline[]);
				return end;
			}
			return FAIL;
		case DOLLAR:
			return src.charCodeAt(p + 1) === BRACKET_OPEN ? fn(p) : FAIL;
		case AT:
			return mention(p);
		case HASH:
			return hashtag(p);
		case COLON:
			return emojiCode(p);
		case QUESTION:
			return src.charCodeAt(p + 1) === BRACKET_OPEN ? link(p, p + 2) : FAIL;
		case BRACKET_OPEN:
			return link(p, p + 1);
		case LOWER_H:
			return url(p);
		default:
			return FAIL;
	}
}

// ---- syntaxes: block ----

function quote(p: number): number {
	let q = skipNewline(skipNewline(p));
	if (!atLineBegin(q) || src.charCodeAt(q) !== GT) {
		return FAIL;
	}
	// lines that start with ">"
	let content = '';
	let lines = 0;
	for (;;) {
		let lineStart = q + 1;
		if (isSpace(src.charCodeAt(lineStart))) {
			lineStart++;
		}
		let lineEnd = lineStart;
		while (lineEnd < len && !isNewline(src.charCodeAt(lineEnd))) {
			lineEnd++;
		}
		const line = src.slice(lineStart, lineEnd);
		content = lines === 0 ? line : content + '\n' + line;
		lines++;
		q = lineEnd;
		const next = skipNewline(q);
		if (next === q || src.charCodeAt(next) !== GT) {
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
	if (budget > 0 && depth + 1 < nestLimit) {
		budget--;
		const outerSrc = src;
		const outerLen = len;
		const outerMemo = memo;
		const outerInQuote = inQuote;
		src = content;
		len = content.length;
		memo = null;
		inQuote = true;
		foundEmojiAt = -1;
		depth++;
		inner = fullSeq();
		depth--;
		src = outerSrc;
		len = outerLen;
		memo = outerMemo;
		inQuote = outerInQuote;
		foundEmojiAt = -1;
	} else {
		// every character of the content tries to nest and ends up in a text
		useBudget(content.length);
		inner = [TEXT(content)];
	}
	node = QUOTE(inner);
	return q;
}

function findCodeBlockEnd(from: number): number {
	for (let p = from; p < len; p++) {
		if (isNewline(src.charCodeAt(p))) {
			const mark = skipNewline(p);
			if (src.startsWith('```', mark) && atLineEnd(mark + 3)) {
				return p;
			}
		}
	}
	return len;
}

function codeBlock(p: number): number {
	let q = skipNewline(p);
	if (!atLineBegin(q) || !src.startsWith('```', q)) {
		return FAIL;
	}
	q += 3;
	const langStart = q;
	while (q < len && !isNewline(src.charCodeAt(q))) {
		q++;
	}
	if (q === len) {
		return FAIL;
	}
	const langEnd = q;
	const codeStart = skipNewline(q);
	const codeEnd = scan(SPAN_CODE_BLOCK, codeStart, findCodeBlockEnd);
	if (codeEnd === codeStart || codeEnd === len) {
		return FAIL;
	}
	// the closing mark is there because the scan stopped before it
	const end = skipNewline(skipNewline(codeEnd) + 3);
	const lang = src.slice(langStart, langEnd).trim();
	node = CODE_BLOCK(src.slice(codeStart, codeEnd), lang.length > 0 ? lang : null);
	return end;
}

function findMathBlockEnd(from: number): number {
	for (let p = from; p < len; p++) {
		const code = src.charCodeAt(p);
		if ((code === BACKSLASH || isNewline(code)) && src.startsWith('\\]', skipNewline(p))) {
			return p;
		}
	}
	return len;
}

function mathBlock(p: number): number {
	let q = skipNewline(p);
	if (!atLineBegin(q) || !src.startsWith('\\[', q)) {
		return FAIL;
	}
	const formulaStart = skipNewline(q + 2);
	const formulaEnd = scan(SPAN_MATH_BLOCK, formulaStart, findMathBlockEnd);
	if (formulaEnd === formulaStart || formulaEnd === len) {
		return FAIL;
	}
	q = skipNewline(formulaEnd) + 2;
	if (!atLineEnd(q)) {
		return FAIL;
	}
	node = MATH_BLOCK(src.slice(formulaStart, formulaEnd));
	return skipNewline(q);
}

function centerTag(p: number): number {
	const open = skipNewline(p);
	if (!atLineBegin(open) || !src.startsWith('<center>', open)) {
		return FAIL;
	}
	const end = itemsThen(SYNTAX_CENTER, skipNewline(open + 8));
	if (end !== FAIL) {
		node = CENTER(children as MfmInline[]);
	}
	return end;
}

function centerTail(p: number): number {
	let q = skipNewline(p);
	if (!src.startsWith('</center>', q)) {
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
	if (src.charCodeAt(end - 1) === 0x7d22 && src.charCodeAt(end - 2) === 0x691c) {
		return 2;
	}
	if (end >= 6
		&& (src.charCodeAt(end - 6) | 0x20) === 0x73
		&& (src.charCodeAt(end - 5) | 0x20) === 0x65
		&& (src.charCodeAt(end - 4) | 0x20) === 0x61
		&& (src.charCodeAt(end - 3) | 0x20) === 0x72
		&& (src.charCodeAt(end - 2) | 0x20) === 0x63
		&& (src.charCodeAt(end - 1) | 0x20) === 0x68) {
		return 6;
	}
	return 0;
}

function search(p: number): number {
	const queryStart = skipNewline(p);
	if (!atLineBegin(queryStart)) {
		return FAIL;
	}
	let lineEnd = queryStart;
	while (lineEnd < len && !isNewline(src.charCodeAt(lineEnd))) {
		lineEnd++;
	}
	// The line ends with a space and a button. The button is "search" or "検索", which can be in "[]".
	let button: number;
	if (src.charCodeAt(lineEnd - 1) === BRACKET_CLOSE) {
		const word = searchWordLength(lineEnd - 1);
		if (word === 0 || src.charCodeAt(lineEnd - 2 - word) !== BRACKET_OPEN) {
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
	if (queryEnd <= queryStart || !isSpace(src.charCodeAt(queryEnd))) {
		return FAIL;
	}
	node = SEARCH(src.slice(queryStart, queryEnd), src.slice(queryStart, lineEnd));
	return skipNewline(lineEnd);
}

// ---- syntaxes: inline ----

function unicodeEmoji(p: number): number {
	const end = p === foundEmojiAt ? foundEmojiEnd : matchEmoji(src, p);
	if (end === FAIL) {
		return FAIL;
	}
	// 異体字セレクタ(U+FE0F)の場合は文字として返す
	node = (end === p + 1 && src.charCodeAt(p) === VARIATION_SELECTOR_16) ? null : UNI_EMOJI(src.slice(p, end));
	return end;
}

function emojiCode(p: number): number {
	let q = p + 1;
	for (;;) {
		const code = src.charCodeAt(q);
		if (!(code < 0x80 && (ascii[code] & A_EMOJI_CODE) !== 0)) {
			break;
		}
		q++;
	}
	if (q === p + 1 || src.charCodeAt(q) !== COLON) {
		return FAIL;
	}
	// the character after the closing mark is not an alphanumeric
	if (isAlnum(src.charCodeAt(q + 1))) {
		return FAIL;
	}
	node = EMOJI_CODE(src.slice(p + 1, q));
	return q + 1;
}

/** `__word__`, where the word is alphanumerics and spaces */
function boldUnder(p: number): number {
	if (src.charCodeAt(p + 1) !== UNDERSCORE) {
		return FAIL;
	}
	const end = wordEnd(p + 2);
	if (end === p + 2 || src.charCodeAt(end) !== UNDERSCORE || src.charCodeAt(end + 1) !== UNDERSCORE) {
		return FAIL;
	}
	node = BOLD([TEXT(src.slice(p + 2, end))]);
	return end + 2;
}

/** `*word*` or `_word_`, where the word is alphanumerics and spaces */
function italicWord(p: number, mark: number): number {
	const end = wordEnd(p + 1);
	if (end === p + 1 || src.charCodeAt(end) !== mark) {
		return FAIL;
	}
	// check before
	if (isAlnum(src.charCodeAt(p - 1))) {
		return FAIL;
	}
	node = ITALIC([TEXT(src.slice(p + 1, end))]);
	return end + 1;
}

function wordEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = src.charCodeAt(p);
		if (!isAlnum(code) && !isSpace(code)) {
			return p;
		}
		p++;
	}
}

function findPlainEnd(from: number): number {
	for (let p = from; p < len; p++) {
		const code = src.charCodeAt(p);
		if ((code === LT || isNewline(code)) && src.startsWith('</plain>', skipNewline(p))) {
			return p;
		}
	}
	return len;
}

function plainTag(p: number): number {
	if (!src.startsWith('<plain>', p)) {
		return FAIL;
	}
	const textStart = skipNewline(p + 7);
	const textEnd = scan(SPAN_PLAIN, textStart, findPlainEnd);
	if (textEnd === textStart || textEnd === len) {
		return FAIL;
	}
	node = PLAIN(src.slice(textStart, textEnd));
	return skipNewline(textEnd) + 8;
}

function fnNameEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = src.charCodeAt(p);
		if (!(code < 0x80 && (ascii[code] & A_FN_NAME) !== 0)) {
			return p;
		}
		p++;
	}
}

function mentionCharsEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = src.charCodeAt(p);
		if (!(code < 0x80 && (ascii[code] & A_MENTION) !== 0)) {
			return p;
		}
		p++;
	}
}

/** `$[name.args content]`. The position must be at "$[". */
function fn(p: number): number {
	node = null;
	const nameStart = p + 2;
	let q = fnNameEnd(nameStart);
	if (q === nameStart) {
		return q;
	}
	const name = src.slice(nameStart, q);
	let args: MfmFn['props']['args'] = {};
	if (src.charCodeAt(q) === DOT) {
		// ".key=value,key"
		const parsed: MfmFn['props']['args'] = {};
		let argStart = q + 1;
		let argsEnd = FAIL;
		for (;;) {
			const keyEnd = fnNameEnd(argStart);
			if (keyEnd === argStart) {
				break;
			}
			const key = src.slice(argStart, keyEnd);
			argsEnd = keyEnd;
			let value: string | true = true;
			if (src.charCodeAt(keyEnd) === EQUAL) {
				// [a-z0-9_.-]+
				const valueEnd = mentionCharsEnd(keyEnd + 1);
				if (valueEnd > keyEnd + 1) {
					value = src.slice(keyEnd + 1, valueEnd);
					argsEnd = valueEnd;
				}
			}
			parsed[key] = value;
			if (src.charCodeAt(argsEnd) !== COMMA) {
				break;
			}
			argStart = argsEnd + 1;
		}
		if (argsEnd !== FAIL) {
			args = parsed;
			q = argsEnd;
		}
	}
	if (src.charCodeAt(q) !== SPACE) {
		return q;
	}
	const contentStart = q + 1;
	const contentEnd = inlineItems(contentStart, ']', false);
	node = null;
	if (contentEnd === contentStart || src.charCodeAt(contentEnd) !== BRACKET_CLOSE) {
		return contentEnd;
	}
	node = FN(name, args, children as MfmInline[]);
	return contentEnd + 1;
}

function inlineCode(p: number): number {
	let q = p + 1;
	for (; q < len; q++) {
		const code = src.charCodeAt(q);
		if (code === BACKTICK || code === ACUTE || isNewline(code)) {
			break;
		}
	}
	if (q === p + 1 || src.charCodeAt(q) !== BACKTICK) {
		return FAIL;
	}
	node = INLINE_CODE(src.slice(p + 1, q));
	return q + 1;
}

function findMathInlineEnd(from: number): number {
	for (let p = from; p < len; p++) {
		const code = src.charCodeAt(p);
		if (isNewline(code) || (code === BACKSLASH && src.charCodeAt(p + 1) === PAREN_CLOSE)) {
			return p;
		}
	}
	return len;
}

function mathInline(p: number): number {
	if (src.charCodeAt(p + 1) !== PAREN_OPEN) {
		return FAIL;
	}
	const start = p + 2;
	const end = scan(SPAN_MATH_INLINE, start, findMathInlineEnd);
	if (end === start || src.charCodeAt(end) !== BACKSLASH) {
		return FAIL;
	}
	node = MATH_INLINE(src.slice(start, end));
	return end + 2;
}

function mention(p: number): number {
	if (linkLabel) {
		return FAIL;
	}
	const nameEnd = mentionCharsEnd(p + 1);
	if (nameEnd === p + 1) {
		return FAIL;
	}
	// check before (not mention)
	if (isAlnum(src.charCodeAt(p - 1))) {
		return FAIL;
	}
	let end = nameEnd;
	let hostEnd = FAIL;
	if (src.charCodeAt(nameEnd) === AT) {
		hostEnd = mentionCharsEnd(nameEnd + 1);
		if (hostEnd > nameEnd + 1) {
			end = hostEnd;
		} else {
			hostEnd = FAIL;
		}
	}
	let valid = true;
	// remove [.-] of tail of hostname
	let host: string | null = null;
	if (hostEnd !== FAIL) {
		let trimmed = hostEnd;
		while (trimmed > nameEnd + 1 && isDotOrHyphen(src.charCodeAt(trimmed - 1))) {
			trimmed--;
		}
		if (trimmed > nameEnd + 1) {
			host = src.slice(nameEnd + 1, trimmed);
		} else {
			// disallow invalid char only hostname
			valid = false;
		}
	}
	// remove [.-] of tail of username
	let trimmedNameEnd = nameEnd;
	while (trimmedNameEnd > p + 1 && isDotOrHyphen(src.charCodeAt(trimmedNameEnd - 1))) {
		trimmedNameEnd--;
	}
	if (trimmedNameEnd < nameEnd && host !== null) {
		// cannnot to remove tail of username if exist hostname
		valid = false;
		trimmedNameEnd = nameEnd;
	}
	// disallow [.-] of head of username
	if (trimmedNameEnd === p + 1 || isDotOrHyphen(src.charCodeAt(p + 1))) {
		valid = false;
	}
	// disallow [.-] of head of hostname
	if (host !== null && isDotOrHyphen(host.charCodeAt(0))) {
		valid = false;
	}
	// generate a text if mention is invalid
	if (!valid) {
		node = null;
		return end;
	}
	const name = src.slice(p + 1, trimmedNameEnd);
	const acct = host !== null ? `@${name}@${host}` : `@${name}`;
	node = MENTION(name, host, acct);
	return p + acct.length;
}

function isDotOrHyphen(code: number): boolean {
	return code === DOT || code === 0x2d;
}

/** Returns the closing bracket of the opening bracket that can be in a hashtag, or 0. */
function hashtagBracketClose(open: number): number {
	switch (open) {
		case PAREN_OPEN: return PAREN_CLOSE;
		case BRACKET_OPEN: return BRACKET_CLOSE;
		case 0x300c: return 0x300d; // 「」
		case 0xff08: return 0xff09; // （）
		default: return 0;
	}
}

/** A character of a hashtag, or a pair of brackets with items inside. */
function hashtagItem(p: number): number {
	const code = src.charCodeAt(p);
	const close = hashtagBracketClose(code);
	if (close === 0) {
		return isHashtagChar(code) ? p + 1 : FAIL;
	}
	let q = p + 1;
	while (q < len) {
		let end: number;
		if (budget > 0 && (budget--, depth + 1 < nestLimit)) {
			depth++;
			end = hashtagItem(q);
			depth--;
		} else {
			end = isHashtagChar(src.charCodeAt(q)) ? q + 1 : FAIL;
		}
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	return src.charCodeAt(q) === close ? q + 1 : FAIL;
}

function hashtag(p: number): number {
	if (linkLabel) {
		return FAIL;
	}
	let q = p + 1;
	while (q < len) {
		const end = hashtagItem(q);
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	if (q === p + 1) {
		return FAIL;
	}
	// check before
	if (isAlnum(src.charCodeAt(p - 1))) {
		return FAIL;
	}
	// disallow number only
	let numberOnly = true;
	for (let i = p + 1; i < q; i++) {
		const code = src.charCodeAt(i);
		if (code < 0x30 || code > 0x39) {
			numberOnly = false;
			break;
		}
	}
	if (numberOnly) {
		return FAIL;
	}
	node = HASHTAG(src.slice(p + 1, q));
	return q;
}

/** Returns the position after "http://" or "https://", or FAIL. */
function urlScheme(p: number): number {
	if (!src.startsWith('http', p)) {
		return FAIL;
	}
	const q = src.charCodeAt(p + 4) === 0x73 ? p + 5 : p + 4;
	return src.startsWith('://', q) ? q + 3 : FAIL;
}

/** A character of a url, or a pair of brackets with items inside. */
function urlItem(p: number): number {
	const code = src.charCodeAt(p);
	let close: number;
	if (code === PAREN_OPEN) {
		close = PAREN_CLOSE;
	} else if (code === BRACKET_OPEN) {
		close = BRACKET_CLOSE;
	} else {
		return isUrlChar(code) ? p + 1 : FAIL;
	}
	let q = p + 1;
	while (q < len) {
		let end: number;
		if (budget > 0 && (budget--, depth + 1 < nestLimit)) {
			depth++;
			end = urlItem(q);
			depth--;
		} else {
			end = isUrlChar(src.charCodeAt(q)) ? q + 1 : FAIL;
		}
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	return src.charCodeAt(q) === close ? q + 1 : FAIL;
}

function url(p: number): number {
	if (linkLabel) {
		return FAIL;
	}
	const contentStart = urlScheme(p);
	if (contentStart === FAIL) {
		return FAIL;
	}
	let q = contentStart;
	while (q < len) {
		const end = urlItem(q);
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	if (q === contentStart) {
		return FAIL;
	}
	// remove the ".," at the right end
	let end = q;
	while (end > contentStart) {
		const code = src.charCodeAt(end - 1);
		if (code !== DOT && code !== COMMA) {
			break;
		}
		end--;
	}
	if (end === contentStart) {
		node = null;
		return q;
	}
	node = N_URL(src.slice(p, end), false);
	return end;
}

function findUrlAltEnd(from: number): number {
	for (let p = from; p < len; p++) {
		const code = src.charCodeAt(p);
		if (code === GT || isSpace(code)) {
			return p;
		}
	}
	return len;
}

/** `<https://example.com>` */
function urlAlt(p: number): number {
	if (linkLabel) {
		return FAIL;
	}
	const contentStart = urlScheme(p + 1);
	if (contentStart === FAIL) {
		return FAIL;
	}
	const end = scan(SPAN_URL_ALT, contentStart, findUrlAltEnd);
	if (end === contentStart || src.charCodeAt(end) !== GT) {
		return FAIL;
	}
	node = N_URL(src.slice(p + 1, end), true);
	return end + 1;
}

/** `[label](url)` or `?[label](url)`. `labelStart` is the position after "[". */
function link(p: number, labelStart: number): number {
	if (linkLabel) {
		return FAIL;
	}
	const end = itemsThen(SYNTAX_LINK, labelStart);
	if (end !== FAIL) {
		node = LINK(labelStart === p + 2, linkUrl, children as MfmInline[]);
	}
	return end;
}

/** `](url)` after the label of a link. Leaves the url in `linkUrl`. */
function linkTail(p: number): number {
	if (src.charCodeAt(p) !== BRACKET_CLOSE || src.charCodeAt(p + 1) !== PAREN_OPEN) {
		return FAIL;
	}
	const code = src.charCodeAt(p + 2);
	let end = FAIL;
	if (code === LT) {
		end = urlAlt(p + 2);
	} else if (code === LOWER_H) {
		end = url(p + 2);
	}
	// a url that ended up in a text is invalid
	if (end === FAIL || node === null || src.charCodeAt(end) !== PAREN_CLOSE) {
		return FAIL;
	}
	linkUrl = (node as MfmUrl).props.url;
	return end + 1;
}

// ---- entry points ----

function prepare(): void {
	if (prepared) {
		return;
	}
	const matcher = emojiMatcher();
	const specials = '<>*_`\\~$@#:?[]h\r\n';
	for (let i = 0; i < specials.length; i++) {
		kinds[specials.charCodeAt(i)] |= K_SPECIAL | K_SYNTAX;
	}
	kinds[COLON] |= K_SIMPLE_SPECIAL;
	kinds[LT] |= K_SIMPLE_SPECIAL;
	if (matcher.firstCodes !== null) {
		for (const code of matcher.firstCodes) {
			kinds[code] |= K_SPECIAL | K_SIMPLE_SPECIAL | K_EMOJI;
		}
	} else {
		for (let code = 0; code < kinds.length; code++) {
			kinds[code] |= K_SPECIAL | K_SIMPLE_SPECIAL | K_EMOJI;
		}
	}
	matchEmoji = matcher.match;
	prepared = true;
}

function reset(): void {
	src = '';
	len = 0;
	depth = 0;
	linkLabel = false;
	node = null;
	children = [];
	memo = null;
	quoteMemos = null;
	inQuote = false;
	foundEmojiAt = -1;
}

/**
 * @param nestBudget for tests. how many times nesting can be tried
*/
export function fullParser(input: string, opts: { nestLimit?: number, nestBudget?: number }): MfmNode[] {
	prepare();
	reset();
	src = input;
	len = input.length;
	nestLimit = opts.nestLimit ?? 20;
	// normal input uses at most about 4 per character
	budget = opts.nestBudget ?? (input.length * 20 + 1000);
	try {
		return fullSeq();
	} finally {
		reset();
	}
}

export function simpleParser(input: string): MfmSimpleNode[] {
	prepare();
	reset();
	src = input;
	len = input.length;
	try {
		return simpleSeq();
	} finally {
		reset();
	}
}
