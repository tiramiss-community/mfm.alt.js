//
// The state of a parsing.
//
// The syntaxes are functions in several modules, and they share the state through the object `state`.
// (A module cannot assign to a variable that another module exports, so the state is an object.)
//

import type { MfmNode } from '../node';
import type { InputMemo } from './memo';

/** returned by a syntax that does not match */
export const FAIL = -1;

class ParseState {
	/** the input. inside a quote, it is the content of the quote */
	src = '';
	len = 0;
	nestLimit = 0;
	depth = 0;
	/** how many times nesting can be tried any more */
	budget = 0;
	/** inside the label of a link, where mentions, hashtags, urls and links are not parsed */
	linkLabel = false;

	/** the node of the syntax that matched last, or `null` when it should be a text */
	node: MfmNode | null = null;
	/** the children of the syntax that matched last */
	children: MfmNode[] = [];
	/** whether `enclosed` found the closing mark */
	closed = false;
	/** the url of `linkTail` that matched last */
	linkUrl = '';

	/** The emoji that `textRunEnd` found last: its position in `src` and its end. */
	foundEmojiAt = -1;
	foundEmojiEnd = -1;

	/** the memo of `src`. made when it is needed */
	memo: InputMemo | null = null;
	/** the memos of the contents of quotes. contents of the same string share a memo */
	quoteMemos: Map<string, InputMemo> | null = null;
	inQuote = false;

	/** Starts parsing the input. */
	reset(input: string): void {
		this.src = input;
		this.len = input.length;
		this.depth = 0;
		this.linkLabel = false;
		this.node = null;
		this.children = [];
		this.memo = null;
		this.quoteMemos = null;
		this.inQuote = false;
		this.foundEmojiAt = -1;
	}
}

export const state = new ParseState();
