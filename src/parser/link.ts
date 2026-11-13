//
// Inline syntaxes that refer to something: mention, hashtag, url, url in brackets and link.
//

import { HASHTAG, LINK, MENTION, N_URL } from '../node';
import type { MfmInline, MfmUrl } from '../node';
import { A_MENTION, ascii, AT, BRACKET_CLOSE, BRACKET_OPEN, COMMA, DOT, GT, isAlnum, isDotOrHyphen, isHashtagChar, isSpace, isUrlChar, LOWER_H, LT, PAREN_CLOSE, PAREN_OPEN } from './chars';
import { scan, SPAN_URL_ALT } from './memo';
import { itemsThen, SYNTAX_LINK } from './sequence';
import { FAIL, state } from './state';

export function mentionCharsEnd(start: number): number {
	let p = start;
	for (;;) {
		const code = state.src.charCodeAt(p);
		if (!(code < 0x80 && (ascii[code] & A_MENTION) !== 0)) {
			return p;
		}
		p++;
	}
}

export function mention(p: number): number {
	if (state.linkLabel) {
		return FAIL;
	}
	const nameEnd = mentionCharsEnd(p + 1);
	if (nameEnd === p + 1) {
		return FAIL;
	}
	// check before (not mention)
	if (isAlnum(state.src.charCodeAt(p - 1))) {
		return FAIL;
	}
	let end = nameEnd;
	let hostEnd = FAIL;
	if (state.src.charCodeAt(nameEnd) === AT) {
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
		while (trimmed > nameEnd + 1 && isDotOrHyphen(state.src.charCodeAt(trimmed - 1))) {
			trimmed--;
		}
		if (trimmed > nameEnd + 1) {
			host = state.src.slice(nameEnd + 1, trimmed);
		} else {
			// disallow invalid char only hostname
			valid = false;
		}
	}
	// remove [.-] of tail of username
	let trimmedNameEnd = nameEnd;
	while (trimmedNameEnd > p + 1 && isDotOrHyphen(state.src.charCodeAt(trimmedNameEnd - 1))) {
		trimmedNameEnd--;
	}
	if (trimmedNameEnd < nameEnd && host !== null) {
		// cannnot to remove tail of username if exist hostname
		valid = false;
		trimmedNameEnd = nameEnd;
	}
	// disallow [.-] of head of username
	if (trimmedNameEnd === p + 1 || isDotOrHyphen(state.src.charCodeAt(p + 1))) {
		valid = false;
	}
	// disallow [.-] of head of hostname
	if (host !== null && isDotOrHyphen(host.charCodeAt(0))) {
		valid = false;
	}
	// generate a text if mention is invalid
	if (!valid) {
		state.node = null;
		return end;
	}
	const name = state.src.slice(p + 1, trimmedNameEnd);
	const acct = host !== null ? `@${name}@${host}` : `@${name}`;
	state.node = MENTION(name, host, acct);
	return p + acct.length;
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
	const code = state.src.charCodeAt(p);
	const close = hashtagBracketClose(code);
	if (close === 0) {
		return isHashtagChar(code) ? p + 1 : FAIL;
	}
	let q = p + 1;
	while (q < state.len) {
		let end: number;
		if (state.budget > 0 && (state.budget--, state.depth + 1 < state.nestLimit)) {
			state.depth++;
			end = hashtagItem(q);
			state.depth--;
		} else {
			end = isHashtagChar(state.src.charCodeAt(q)) ? q + 1 : FAIL;
		}
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	return state.src.charCodeAt(q) === close ? q + 1 : FAIL;
}

export function hashtag(p: number): number {
	if (state.linkLabel) {
		return FAIL;
	}
	let q = p + 1;
	while (q < state.len) {
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
	if (isAlnum(state.src.charCodeAt(p - 1))) {
		return FAIL;
	}
	// disallow number only
	let numberOnly = true;
	for (let i = p + 1; i < q; i++) {
		const code = state.src.charCodeAt(i);
		if (code < 0x30 || code > 0x39) {
			numberOnly = false;
			break;
		}
	}
	if (numberOnly) {
		return FAIL;
	}
	state.node = HASHTAG(state.src.slice(p + 1, q));
	return q;
}

/** Returns the position after "http://" or "https://", or FAIL. */
function urlScheme(p: number): number {
	if (!state.src.startsWith('http', p)) {
		return FAIL;
	}
	const q = state.src.charCodeAt(p + 4) === 0x73 ? p + 5 : p + 4;
	return state.src.startsWith('://', q) ? q + 3 : FAIL;
}

/** A character of a url, or a pair of brackets with items inside. */
function urlItem(p: number): number {
	const code = state.src.charCodeAt(p);
	let close: number;
	if (code === PAREN_OPEN) {
		close = PAREN_CLOSE;
	} else if (code === BRACKET_OPEN) {
		close = BRACKET_CLOSE;
	} else {
		return isUrlChar(code) ? p + 1 : FAIL;
	}
	let q = p + 1;
	while (q < state.len) {
		let end: number;
		if (state.budget > 0 && (state.budget--, state.depth + 1 < state.nestLimit)) {
			state.depth++;
			end = urlItem(q);
			state.depth--;
		} else {
			end = isUrlChar(state.src.charCodeAt(q)) ? q + 1 : FAIL;
		}
		if (end === FAIL) {
			break;
		}
		q = end;
	}
	return state.src.charCodeAt(q) === close ? q + 1 : FAIL;
}

export function url(p: number): number {
	if (state.linkLabel) {
		return FAIL;
	}
	const contentStart = urlScheme(p);
	if (contentStart === FAIL) {
		return FAIL;
	}
	let q = contentStart;
	while (q < state.len) {
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
		const code = state.src.charCodeAt(end - 1);
		if (code !== DOT && code !== COMMA) {
			break;
		}
		end--;
	}
	if (end === contentStart) {
		state.node = null;
		return q;
	}
	state.node = N_URL(state.src.slice(p, end), false);
	return end;
}

function findUrlAltEnd(from: number): number {
	for (let p = from; p < state.len; p++) {
		const code = state.src.charCodeAt(p);
		if (code === GT || isSpace(code)) {
			return p;
		}
	}
	return state.len;
}

/** `<https://example.com>` */
export function urlAlt(p: number): number {
	if (state.linkLabel) {
		return FAIL;
	}
	const contentStart = urlScheme(p + 1);
	if (contentStart === FAIL) {
		return FAIL;
	}
	const end = scan(SPAN_URL_ALT, contentStart, findUrlAltEnd);
	if (end === contentStart || state.src.charCodeAt(end) !== GT) {
		return FAIL;
	}
	state.node = N_URL(state.src.slice(p + 1, end), true);
	return end + 1;
}

/** `[label](url)` or `?[label](url)`. `labelStart` is the position after "[". */
export function link(p: number, labelStart: number): number {
	if (state.linkLabel) {
		return FAIL;
	}
	const end = itemsThen(SYNTAX_LINK, labelStart);
	if (end !== FAIL) {
		state.node = LINK(labelStart === p + 2, state.linkUrl, state.children as MfmInline[]);
	}
	return end;
}

/** `](url)` after the label of a link. Leaves the url in `linkUrl`. */
export function linkTail(p: number): number {
	if (state.src.charCodeAt(p) !== BRACKET_CLOSE || state.src.charCodeAt(p + 1) !== PAREN_OPEN) {
		return FAIL;
	}
	const code = state.src.charCodeAt(p + 2);
	let end = FAIL;
	if (code === LT) {
		end = urlAlt(p + 2);
	} else if (code === LOWER_H) {
		end = url(p + 2);
	}
	// a url that ended up in a text is invalid
	if (end === FAIL || state.node === null || state.src.charCodeAt(end) !== PAREN_CLOSE) {
		return FAIL;
	}
	state.linkUrl = (state.node as MfmUrl).props.url;
	return end + 1;
}
