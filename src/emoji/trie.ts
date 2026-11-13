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

/** nodes with more children than this use a table */
const TABLE_MIN_CHILDREN = 4;
const TABLE_MAX_SPAN = 1024;
const MAX_STEPS = 5000000;

class TrieNode {
	/**
	 * Set when a string of the regexp ends at this node. It tells the order in which the regexp reaches
	 * the strings: the regexp returns the first string it reaches, so the smallest rank on the path of
	 * an input wins. It is the choices that the regexp made on the way (see `Trie.walk`).
	*/
	rank: string | null = null;
	/** Same as `rank`, but for a string that must not be followed by one of `notNext`. */
	guarded: { rank: string, notNext: number[] } | null = null;
	/** The smallest `rank` from the root to this node, and the length of the string that has it. */
	bestRank: string | null = null;
	bestLength = 0;

	/** the code units from the root to this node */
	readonly prefix: number[];
	/** the indexes of the alternatives of the regexp that can go through this node. `null` means all of them */
	alts: number[] | null;
	/** whether the children have been made */
	expanded = false;
	// The children. They are in `map` while the node is being expanded. After that, `freeze` leaves them
	// there only when they are many and sparse. A few children are in `codes` and `nodes` in parallel, and
	// many children in a narrow range are in `table`.
	map: Map<number, TrieNode> | null = new Map();
	codes: number[] = [];
	nodes: TrieNode[] = [];
	tableBase = 0;
	table: (TrieNode | undefined)[] | null = null;

	constructor(prefix: number[], alts: number[] | null) {
		this.prefix = prefix;
		this.alts = alts;
	}

	/** Returns the child while the node is being expanded. `alt` is the alternative that goes through it. */
	child(code: number, alt: number): TrieNode {
		const map = this.map;
		if (map === null) {
			throw new Error('the node has been expanded');
		}
		let node = map.get(code);
		if (node === undefined) {
			node = new TrieNode([...this.prefix, code], [alt]);
			map.set(code, node);
		} else if (node.alts !== null && node.alts[node.alts.length - 1] !== alt) {
			node.alts.push(alt);
		}
		return node;
	}

	next(code: number): TrieNode | undefined {
		if (this.table !== null) {
			const offset = code - this.tableBase;
			return (offset >= 0 && offset < this.table.length) ? this.table[offset] : undefined;
		}
		if (this.map !== null) {
			return this.map.get(code);
		}
		const codes = this.codes;
		for (let i = 0; i < codes.length; i++) {
			if (codes[i] === code) {
				return this.nodes[i];
			}
		}
		return undefined;
	}

	freeze(): void {
		let min = Infinity;
		let max = -Infinity;
		for (const [code, node] of this.map ?? []) {
			if (node.rank !== null && (this.bestRank === null || node.rank < this.bestRank)) {
				node.bestRank = node.rank;
				node.bestLength = node.prefix.length;
			} else {
				node.bestRank = this.bestRank;
				node.bestLength = this.bestLength;
			}
			this.codes.push(code);
			this.nodes.push(node);
			if (code < min) min = code;
			if (code > max) max = code;
		}
		if (this.codes.length <= TABLE_MIN_CHILDREN) {
			this.map = null;
			return;
		}
		if (max - min >= TABLE_MAX_SPAN) {
			return;
		}
		this.map = null;
		const table: (TrieNode | undefined)[] = [];
		for (let i = min; i <= max; i++) {
			table.push(undefined);
		}
		for (let i = 0; i < this.codes.length; i++) {
			table[this.codes[i] - min] = this.nodes[i];
		}
		this.tableBase = min;
		this.table = table;
	}
}

/** Called at the end of a sequence. `child` is the node of the string if it is one unit longer than the prefix. */
type Then = (depth: number, child: TrieNode | null, path: string, notNext: number[] | null) => void;

export class Trie {
	readonly root = new TrieNode([], null);
	private readonly alts: Item[][];
	private steps = 0;
	// the node that is being expanded
	private target: TrieNode = this.root;
	private alt = 0;

	constructor(alts: Item[][]) {
		this.alts = alts;
		this.expand(this.root);
	}

	/** Makes the children of the node. */
	expand(node: TrieNode): void {
		node.expanded = true;
		this.target = node;
		const count = node.alts === null ? this.alts.length : node.alts.length;
		for (let i = 0; i < count; i++) {
			this.alt = node.alts === null ? i : node.alts[i];
			this.walk(this.alts[this.alt], 0, 0, null, String.fromCharCode(this.alt), null, this.end);
		}
		node.freeze();
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
			const prefix = this.target.prefix;
			if (depth < prefix.length) {
				const code = prefix[depth];
				if (item.set.includes(code) && (notNext === null || !notNext.includes(code))) {
					rest(depth + 1, null, taken, null);
				}
			} else if (depth === prefix.length) {
				for (const code of item.set) {
					if (notNext === null || !notNext.includes(code)) {
						rest(depth + 1, this.target.child(code, this.alt), taken, null);
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
	if (guarded !== null && (node.bestRank === null || guarded < node.bestRank)) {
		return guardedEnd;
	}
	return node.bestRank !== null ? index + node.bestLength : -1;
}
