//
// The trie made from the regexp, and the matching with it.
//
// The regexp returns the first string it reaches, not the longest. So each string in the trie has a rank,
// the order in which the regexp reaches it, and the matching returns the string with the smallest rank.
//
// The trie is built little by little: the children of a node are made when an input reaches the node for
// the first time. So the first parsing does not have to wait for the whole trie.
//

import { UnsupportedSyntax } from './regexp';
import type { Item } from './regexp';

/** nodes with more children than this use a table or a map */
const TABLE_MIN_CHILDREN = 4;
const TABLE_MAX_SPAN = 1024;
const MAX_STEPS = 5000000;

const NO_CHILDREN: (number | TrieNode)[] = [];
// the values of `TrieNode.tableBase` when the children are not in a table
const IN_LIST = -1;
const IN_MAP = -2;

// The trie can grow to thousands of nodes, so a node keeps few fields.
class TrieNode {
	/**
	 * Until the parent is expanded: set when a string of the regexp ends at this node. It tells the order in
	 * which the regexp reaches the strings: the regexp returns the first string it reaches, so the smallest
	 * rank on the path of an input wins. It is the choices that the regexp made on the way (see `Trie.walk`).
	 *
	 * After that: the smallest rank on the path from the root to this node. The string that has it ends
	 * `bestEnd` units after the root.
	*/
	rank: string | null = null;
	bestEnd = 0;
	/** Same as `rank`, but for a string that must not be followed by one of `notNext`. Kept for matching. */
	guarded: { rank: string, notNext: number[] } | null = null;

	/** the parent and the code unit from it, to know the code units from the root at the expansion */
	readonly parent: TrieNode | null;
	readonly code: number;
	/**
	 * The indexes of the alternatives of the regexp that can go through this node.
	 * `null` after the expansion, which no longer needs them.
	*/
	alts: number[] | null;

	/**
	 * The children after the expansion, in one of the following forms by `tableBase`:
	 * - IN_LIST: a few children as [code, node, code, node, ...]
	 * - IN_MAP: many sparse children in a map
	 * - otherwise: many children in a narrow range, indexed by the code minus `tableBase`
	*/
	children: (number | TrieNode)[] | (TrieNode | undefined)[] | Map<number, TrieNode> = NO_CHILDREN;
	tableBase = IN_LIST;

	constructor(parent: TrieNode | null, code: number, alts: number[]) {
		this.parent = parent;
		this.code = code;
		this.alts = alts;
	}

	get expanded(): boolean {
		return this.alts === null;
	}

	/** the code units from the root to this node */
	prefix(): number[] {
		return this.parent === null ? [] : [...this.parent.prefix(), this.code];
	}

	next(code: number): TrieNode | undefined {
		const base = this.tableBase;
		if (base >= 0) {
			const table = this.children as (TrieNode | undefined)[];
			const offset = code - base;
			return (offset >= 0 && offset < table.length) ? table[offset] : undefined;
		}
		if (base === IN_MAP) {
			return (this.children as Map<number, TrieNode>).get(code);
		}
		const list = this.children as (number | TrieNode)[];
		for (let i = 0; i < list.length; i += 2) {
			if (list[i] === code) {
				return list[i + 1] as TrieNode;
			}
		}
		return undefined;
	}

	/** the code units of the children. the node must have been expanded */
	childCodes(): number[] {
		const base = this.tableBase;
		if (base === IN_MAP) {
			return [...(this.children as Map<number, TrieNode>).keys()];
		}
		const codes: number[] = [];
		if (base >= 0) {
			const table = this.children as (TrieNode | undefined)[];
			for (let i = 0; i < table.length; i++) {
				if (table[i] !== undefined) {
					codes.push(base + i);
				}
			}
			return codes;
		}
		const list = this.children as (number | TrieNode)[];
		for (let i = 0; i < list.length; i += 2) {
			codes.push(list[i] as number);
		}
		return codes;
	}

	/** Takes the children made by the expansion. `depth` is the number of the code units from the root. */
	setChildren(children: Map<number, TrieNode>, depth: number): void {
		this.alts = null;
		let min = Infinity;
		let max = -Infinity;
		for (const [code, node] of children) {
			if (node.rank === null || (this.rank !== null && this.rank <= node.rank)) {
				node.rank = this.rank;
				node.bestEnd = this.bestEnd;
			} else {
				node.bestEnd = depth + 1;
			}
			if (code < min) min = code;
			if (code > max) max = code;
		}
		// the arrays are made in their final sizes, because an array grown by `push` keeps spare room
		if (children.size <= TABLE_MIN_CHILDREN) {
			if (children.size > 0) {
				const list: (number | TrieNode)[] = Array.from({ length: children.size * 2 });
				let i = 0;
				for (const [code, node] of children) {
					list[i++] = code;
					list[i++] = node;
				}
				this.children = list;
			}
			return;
		}
		if (max - min >= TABLE_MAX_SPAN) {
			this.children = new Map(children);
			this.tableBase = IN_MAP;
			return;
		}
		const table: (TrieNode | undefined)[] = Array.from({ length: max - min + 1 });
		for (const [code, node] of children) {
			table[code - min] = node;
		}
		this.children = table;
		this.tableBase = min;
	}
}

/** Called at the end of a sequence. `child` is the node of the string if it is one unit longer than the prefix. */
type Then = (depth: number, child: TrieNode | null, path: string, notNext: number[] | null) => void;

export class Trie {
	readonly root: TrieNode;
	private readonly alts: Item[][];
	private steps = 0;
	// the expansion in progress: the node, the code units from the root to it, its children and the alternative
	private target: TrieNode;
	private prefix: number[] = [];
	private children = new Map<number, TrieNode>();
	private alt = 0;

	constructor(alts: Item[][]) {
		this.alts = alts;
		this.root = new TrieNode(null, 0, alts.map((_, index) => index));
		this.target = this.root;
		this.expand(this.root);
	}

	/** Makes the children of the node. */
	expand(node: TrieNode): void {
		const alts = node.alts;
		if (alts === null) {
			return;
		}
		this.target = node;
		this.prefix = node.prefix();
		this.children = new Map();
		for (let i = 0; i < alts.length; i++) {
			this.alt = alts[i];
			this.walk(this.alts[this.alt], 0, 0, null, String.fromCharCode(this.alt), null, this.end);
		}
		node.setChildren(this.children, this.prefix.length);
		this.children = new Map();
		this.prefix = [];
	}

	/** Returns the child of the target. `alt` is the alternative that goes through it. */
	private child(code: number): TrieNode {
		let node = this.children.get(code);
		if (node === undefined) {
			node = new TrieNode(this.target, code, [this.alt]);
			this.children.set(code, node);
		} else {
			const alts = node.alts as number[];
			if (alts[alts.length - 1] !== this.alt) {
				alts.push(this.alt);
			}
		}
		return node;
	}

	private readonly end: Then = (depth, child, path, notNext) => {
		if (depth === 0) {
			// the regexp matches an empty string
			throw new UnsupportedSyntax();
		}
		if (child === null) {
			// a string that is not longer than the prefix. it belongs to an ancestor
			return;
		}
		// The strings come in the order of the rank, so the first one stays.
		if (notNext === null) {
			child.rank ??= path;
		} else if (child.guarded === null) {
			child.guarded = { rank: path, notNext };
		} else if (notNext.length !== child.guarded.notNext.length || notNext.some(code => !child.guarded?.notNext.includes(code))) {
			// two different conditions on a node are not supported
			throw new UnsupportedSyntax();
		}
	};

	/**
	 * Follows the sequence from the item `i` in the order of the backtracking of the regexp, only along the
	 * strings that start with the prefix of the target, and only one code unit further than the prefix.
	 *
	 * `depth` is the number of the code units that have been read.
	 * `path` is the choices that have been made: which alternative was taken, and whether an optional item
	 * was taken. Comparing two paths as strings tells which of them the regexp reaches first.
	 * `notNext` is the pending negative lookahead: the code units that must not come next.
	*/
	private walk(seq: Item[], i: number, depth: number, child: TrieNode | null, path: string, notNext: number[] | null, then: Then): void {
		if (++this.steps > MAX_STEPS) {
			throw new UnsupportedSyntax();
		}
		if (i === seq.length) {
			then(depth, child, path, notNext);
			return;
		}
		const item = seq[i];
		const rest: Then = (nextDepth, nextChild, nextPath, nextNotNext) => this.walk(seq, i + 1, nextDepth, nextChild, nextPath, nextNotNext, then);
		// a greedy optional item is tried first
		const taken = item.optional ? path + '\u0000' : path;
		if (item.type === 'set') {
			const prefix = this.prefix;
			if (depth < prefix.length) {
				const code = prefix[depth];
				if (item.set.includes(code) && (notNext === null || !notNext.includes(code))) {
					rest(depth + 1, null, taken, null);
				}
			} else if (depth === prefix.length) {
				for (const code of item.set) {
					if (notNext === null || !notNext.includes(code)) {
						rest(depth + 1, this.child(code), taken, null);
					}
				}
			}
			// longer strings are left to the expansion of the child
		} else if (item.type === 'group') {
			for (let k = 0; k < item.alts.length; k++) {
				this.walk(item.alts[k], 0, depth, child, taken + String.fromCharCode(k), notNext, rest);
			}
		} else {
			rest(depth, child, path, notNext === null ? item.set : [...notNext, ...item.set]);
		}
		if (item.optional) {
			rest(depth, child, path + '\u0001', notNext);
		}
	}
}

/** Returns the end of the string of the regexp that starts at `index`, or -1. */
export function trieMatch(trie: Trie, input: string, index: number): number {
	const length = input.length;
	let node = trie.root;
	// the best of the strings with a lookahead on the way. they are rare
	let guarded: string | null = null;
	let guardedEnd = -1;
	let at = index;
	while (at < length) {
		if (!node.expanded) {
			trie.expand(node);
		}
		const next = node.next(input.charCodeAt(at));
		if (next === undefined) {
			break;
		}
		node = next;
		at++;
		const candidate = node.guarded;
		if (candidate !== null && (guarded === null || candidate.rank < guarded)
			&& !(at < length && candidate.notNext.includes(input.charCodeAt(at)))) {
			guarded = candidate.rank;
			guardedEnd = at;
		}
	}
	// `rank` of the last node is the best on the path, because its parent has been expanded
	if (guarded !== null && (node.rank === null || guarded < node.rank)) {
		return guardedEnd;
	}
	return node.rank !== null ? index + node.bestEnd : -1;
}
