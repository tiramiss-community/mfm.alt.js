import { fullParser, simpleParser } from './parser';
import { stringifyNode, stringifyTree } from './stringify';
import type { MfmNode, MfmSimpleNode } from './node';

/**
 * Generates a MfmNode tree from the MFM string.
*/
export function parse(input: string, opts: Partial<{ nestLimit: number; }> = {}): MfmNode[] {
	return fullParser(input, { nestLimit: opts.nestLimit });
}

/**
 * Generates a MfmSimpleNode tree from the MFM string.
*/
export function parseSimple(input: string): MfmSimpleNode[] {
	return simpleParser(input);
}

/**
 * Generates a MFM string from the MfmNode tree.
*/
export function toString(tree: MfmNode[]): string;
export function toString(node: MfmNode): string;
export function toString(node: MfmNode | MfmNode[]): string {
	return Array.isArray(node) ? stringifyTree(node) : stringifyNode(node);
}

function inspectOne(node: MfmNode, action: (node: MfmNode) => void): void {
	action(node);
	if (node.children != null) {
		for (const child of node.children) {
			inspectOne(child, action);
		}
	}
}

/**
 * Inspects the MfmNode tree.
*/
export function inspect(node: MfmNode, action: (node: MfmNode) => void): void;
export function inspect(nodes: MfmNode[], action: (node: MfmNode) => void): void;
export function inspect(node: (MfmNode | MfmNode[]), action: (node: MfmNode) => void): void {
	if (Array.isArray(node)) {
		for (const n of node) {
			inspectOne(n, action);
		}
	} else {
		inspectOne(node, action);
	}
}

/**
 * Inspects the MfmNode tree and returns as an array the nodes that match the conditions
 * of the predicate function.
*/
export function extract(nodes: MfmNode[], predicate: (node: MfmNode) => boolean): MfmNode[] {
	const dest: MfmNode[] = [];
	inspect(nodes, (node) => {
		if (predicate(node)) {
			dest.push(node);
		}
	});
	return dest;
}
