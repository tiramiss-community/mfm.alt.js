//
// Chooses the syntaxes to try by the character at the position, in the same order as mfm-js.
//

import { BOLD, FN, ITALIC, SMALL, STRIKE } from '../node';
import type { MfmInline } from '../node';
import { centerTag, codeBlock, mathBlock, quote, search } from './block';
import { ASTERISK, AT, BACKSLASH, BACKTICK, BRACKET_OPEN, COLON, CR, DOLLAR, GT, HASH, K_EMOJI, K_SPECIAL, kinds, LF, LOWER_H, LT, QUESTION, TILDE, UNDERSCORE } from './chars';
import { boldUnder, emojiCode, fn, inlineCode, italicWord, mathInline, plainTag, unicodeEmoji } from './inline';
import { hashtag, link, mention, url, urlAlt } from './link';
import { enclosed } from './sequence';
import { FAIL, state } from './state';

export function full(p: number): number {
	const code = state.src.charCodeAt(p);
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
	state.node = null;
	return p + 1;
}

/** Parses an inline item. The position must be inside the input. */
export function inline(p: number): number {
	const code = state.src.charCodeAt(p);
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
	state.node = null;
	return p + 1;
}

/** Parses an inline syntax other than an emoji and a text. */
function inlineSyntax(p: number, code: number): number {
	let end: number;
	switch (code) {
		case LT:
			switch (state.src.charCodeAt(p + 1)) {
				case 0x73: // s
					if (state.src.startsWith('<small>', p)) {
						end = enclosed(p, 7, '</small>', false);
						if (state.closed) state.node = SMALL(state.children as MfmInline[]);
						return end;
					}
					if (state.src.startsWith('<s>', p)) {
						end = enclosed(p, 3, '</s>', false);
						if (state.closed) state.node = STRIKE(state.children as MfmInline[]);
						return end;
					}
					return FAIL;
				case 0x70: // p
					return plainTag(p);
				case 0x62: // b
					if (state.src.startsWith('<b>', p)) {
						end = enclosed(p, 3, '</b>', false);
						if (state.closed) state.node = BOLD(state.children as MfmInline[]);
						return end;
					}
					return FAIL;
				case 0x69: // i
					if (state.src.startsWith('<i>', p)) {
						end = enclosed(p, 3, '</i>', false);
						if (state.closed) state.node = ITALIC(state.children as MfmInline[]);
						return end;
					}
					return FAIL;
				case LOWER_H:
					return urlAlt(p);
				default:
					return FAIL;
			}
		case ASTERISK:
			if (state.src.charCodeAt(p + 1) === ASTERISK) {
				if (state.src.charCodeAt(p + 2) === ASTERISK) {
					end = enclosed(p, 3, '***', false);
					if (state.closed) state.node = FN('tada', {}, state.children as MfmInline[]);
					return end;
				}
				end = enclosed(p, 2, '**', false);
				if (state.closed) state.node = BOLD(state.children as MfmInline[]);
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
			if (state.src.charCodeAt(p + 1) === TILDE) {
				end = enclosed(p, 2, '~~', true);
				if (state.closed) state.node = STRIKE(state.children as MfmInline[]);
				return end;
			}
			return FAIL;
		case DOLLAR:
			return state.src.charCodeAt(p + 1) === BRACKET_OPEN ? fn(p) : FAIL;
		case AT:
			return mention(p);
		case HASH:
			return hashtag(p);
		case COLON:
			return emojiCode(p);
		case QUESTION:
			return state.src.charCodeAt(p + 1) === BRACKET_OPEN ? link(p, p + 2) : FAIL;
		case BRACKET_OPEN:
			return link(p, p + 1);
		case LOWER_H:
			return url(p);
		default:
			return FAIL;
	}
}
