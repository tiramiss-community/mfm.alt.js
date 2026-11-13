//
// Character codes and character classes.
//

import { emojiMatcher } from '../emoji';
import { FAIL } from './state';

// ---- character codes ----

const TAB = 0x09;
export const LF = 0x0a;
export const CR = 0x0d;
export const SPACE = 0x20;
export const HASH = 0x23; // #
export const DOLLAR = 0x24; // $
export const PAREN_OPEN = 0x28; // (
export const PAREN_CLOSE = 0x29; // )
export const ASTERISK = 0x2a; // *
export const COMMA = 0x2c; // ,
export const DOT = 0x2e; // .
export const COLON = 0x3a; // :
export const LT = 0x3c; // <
export const EQUAL = 0x3d; // =
export const GT = 0x3e; // >
export const QUESTION = 0x3f; // ?
export const AT = 0x40; // @
export const BRACKET_OPEN = 0x5b; // [
export const BACKSLASH = 0x5c; // \
export const BRACKET_CLOSE = 0x5d; // ]
export const UNDERSCORE = 0x5f; // _
export const BACKTICK = 0x60; // `
export const LOWER_H = 0x68; // h
export const TILDE = 0x7e; // ~
export const ACUTE = 0xb4; // ´
const IDEOGRAPHIC_SPACE = 0x3000;
export const VARIATION_SELECTOR_16 = 0xfe0f;

// ---- character classes ----

/** Something other than a text can start at the character in the full and the inline syntax. */
export const K_SPECIAL = 1;

/** Same as K_SPECIAL, for the simple syntax. */
export const K_SIMPLE_SPECIAL = 2;

/** An emoji can start with the code unit. */
export const K_EMOJI = 4;

/** A syntax other than an emoji can start at the character in the full and the inline syntax. */
export const K_SYNTAX = 8;

/** K_* flags of a code unit. filled by `prepareChars` */
export const kinds = new Uint8Array(0x10000);

// flags of an ascii character
const A_ALNUM = 1; // [a-z0-9]
export const A_FN_NAME = 2; // [a-z0-9_]
export const A_MENTION = 4; // [a-z0-9_.-]
export const A_EMOJI_CODE = 8; // [a-z0-9_+-]
const A_URL = 16; // [.,a-z0-9_/:%#@$&?!~=+-]
const A_HASHTAG_STOP = 32; // the ascii characters that end a hashtag

export const ascii = new Uint8Array(0x80);
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

export function isNewline(code: number): boolean {
	return code === LF || code === CR;
}

export function isSpace(code: number): boolean {
	return code === SPACE || code === IDEOGRAPHIC_SPACE || code === TAB;
}

export function isAlnum(code: number): boolean {
	return code < 0x80 && (ascii[code] & A_ALNUM) !== 0;
}

export function isHashtagChar(code: number): boolean {
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

export function isUrlChar(code: number): boolean {
	return code < 0x80 && (ascii[code] & A_URL) !== 0;
}

export function isDotOrHyphen(code: number): boolean {
	return code === DOT || code === 0x2d;
}

// ---- the parts that depend on the emoji data ----

let prepared = false;
/** Returns the end of the emoji that starts at the position, or FAIL. */
export let matchEmoji: (input: string, index: number) => number = () => FAIL;

/** Fills `kinds` and `matchEmoji`. Called before parsing, so that importing this library costs nothing. */
export function prepareChars(): void {
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
