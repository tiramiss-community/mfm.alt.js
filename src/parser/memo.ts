//
// Memos per input. They bound the time on crafted inputs. `spans` does not change the result. `failed`
// does, when the budget runs out, so it is kept the same as the memo of mfm-js.
//

import { state } from './state';

export const SPAN_CODE_BLOCK = 0;
export const SPAN_MATH_BLOCK = 1;
export const SPAN_PLAIN = 2;
export const SPAN_MATH_INLINE = 3;
export const SPAN_URL_ALT = 4;

export class InputMemo {
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

export function getMemo(): InputMemo {
	if (state.memo !== null) {
		return state.memo;
	}
	if (!state.inQuote) {
		state.memo = new InputMemo();
		return state.memo;
	}
	state.quoteMemos ??= new Map();
	let found = state.quoteMemos.get(state.src);
	if (found === undefined) {
		found = new InputMemo();
		state.quoteMemos.set(state.src, found);
	}
	state.memo = found;
	return found;
}

export function scan(span: number, start: number, find: (from: number) => number): number {
	const spans = getMemo().spans;
	if (spans[span * 2] <= start && start <= spans[span * 2 + 1]) {
		return spans[span * 2 + 1];
	}
	const end = find(start);
	spans[span * 2] = start;
	spans[span * 2 + 1] = end;
	return end;
}
