//
// MfmNode tree -> MFM string
//

import { isMfmBlock } from './node';
import type { MfmNode } from './node';

export function stringifyNode(node: MfmNode): string {
	switch (node.type) {
		// block
		case 'quote':
			return stringifyTree(node.children).split('\n').map(line => `> ${line}`).join('\n');
		case 'search':
			return node.props.content;
		case 'blockCode':
			return `\`\`\`${node.props.lang ?? ''}\n${node.props.code}\n\`\`\``;
		case 'mathBlock':
			return `\\[\n${node.props.formula}\n\\]`;
		case 'center':
			return `<center>\n${stringifyTree(node.children)}\n</center>`;
		// inline
		case 'emojiCode':
			return `:${node.props.name}:`;
		case 'unicodeEmoji':
			return node.props.emoji;
		case 'bold':
			return `**${stringifyTree(node.children)}**`;
		case 'small':
			return `<small>${stringifyTree(node.children)}</small>`;
		case 'italic':
			return `<i>${stringifyTree(node.children)}</i>`;
		case 'strike':
			return `~~${stringifyTree(node.children)}~~`;
		case 'inlineCode':
			return `\`${node.props.code}\``;
		case 'mathInline':
			return `\\(${node.props.formula}\\)`;
		case 'mention':
			return node.props.acct;
		case 'hashtag':
			return `#${node.props.hashtag}`;
		case 'url':
			return node.props.brackets ? `<${node.props.url}>` : node.props.url;
		case 'link':
			return `${node.props.silent ? '?' : ''}[${stringifyTree(node.children)}](${node.props.url})`;
		case 'fn': {
			const args = Object.keys(node.props.args).map(key => {
				const value = node.props.args[key];
				return value === true ? key : `${key}=${value}`;
			});
			return `$[${node.props.name}${args.length > 0 ? '.' + args.join(',') : ''} ${stringifyTree(node.children)}]`;
		}
		case 'plain':
			return `<plain>\n${stringifyTree(node.children)}\n</plain>`;
		case 'text':
			return node.props.text;
	}
	throw new Error('unknown mfm node');
}

export function stringifyTree(nodes: MfmNode[]): string {
	let result = '';
	// A newline goes between two nodes unless both of them are inline.
	let previous: 'none' | 'inline' | 'block' = 'none';
	for (const node of nodes) {
		const current = isMfmBlock(node) ? 'block' : 'inline';
		if (previous !== 'none' && !(previous === 'inline' && current === 'inline')) {
			result += '\n';
		}
		result += stringifyNode(node);
		previous = current;
	}
	return result;
}
