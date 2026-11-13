//
// Node definitions. The shapes and the factory functions are the public interface of mfm-js.
//

export type MfmQuote = {
	type: 'quote';
	props?: Record<string, unknown>;
	children: MfmNode[];
};

export type MfmSearch = {
	type: 'search';
	props: {
		query: string;
		content: string;
	};
	children?: [];
};

export type MfmCodeBlock = {
	type: 'blockCode';
	props: {
		code: string;
		lang: string | null;
	};
	children?: [];
};

export type MfmMathBlock = {
	type: 'mathBlock';
	props: {
		formula: string;
	};
	children?: [];
};

export type MfmCenter = {
	type: 'center';
	props?: Record<string, unknown>;
	children: MfmInline[];
};

export type MfmUnicodeEmoji = {
	type: 'unicodeEmoji';
	props: {
		emoji: string;
	};
	children?: [];
};

export type MfmEmojiCode = {
	type: 'emojiCode';
	props: {
		name: string;
	};
	children?: [];
};

export type MfmBold = {
	type: 'bold';
	props?: Record<string, unknown>;
	children: MfmInline[];
};

export type MfmSmall = {
	type: 'small';
	props?: Record<string, unknown>;
	children: MfmInline[];
};

export type MfmItalic = {
	type: 'italic';
	props?: Record<string, unknown>;
	children: MfmInline[];
};

export type MfmStrike = {
	type: 'strike';
	props?: Record<string, unknown>;
	children: MfmInline[];
};

export type MfmInlineCode = {
	type: 'inlineCode';
	props: {
		code: string;
	};
	children?: [];
};

export type MfmMathInline = {
	type: 'mathInline';
	props: {
		formula: string;
	};
	children?: [];
};

export type MfmMention = {
	type: 'mention';
	props: {
		username: string;
		host: string | null;
		acct: string;
	};
	children?: [];
};

export type MfmHashtag = {
	type: 'hashtag';
	props: {
		hashtag: string;
	};
	children?: [];
};

export type MfmUrl = {
	type: 'url';
	props: {
		url: string;
		brackets?: boolean;
	};
	children?: [];
};

export type MfmLink = {
	type: 'link';
	props: {
		silent: boolean;
		url: string;
	};
	children: MfmInline[];
};

export type MfmFn = {
	type: 'fn';
	props: {
		name: string;
		args: Record<string, string | true>;
	};
	children: MfmInline[];
};

export type MfmPlain = {
	type: 'plain';
	props?: Record<string, unknown>;
	children: MfmText[];
};

export type MfmText = {
	type: 'text';
	props: {
		text: string;
	};
	children?: [];
};

export type MfmBlock = MfmQuote | MfmSearch | MfmCodeBlock | MfmMathBlock | MfmCenter;

export type MfmInline = MfmUnicodeEmoji | MfmEmojiCode | MfmBold | MfmSmall | MfmItalic | MfmStrike |
	MfmInlineCode | MfmMathInline | MfmMention | MfmHashtag | MfmUrl | MfmLink | MfmFn | MfmPlain | MfmText;

export type MfmNode = MfmBlock | MfmInline;

export type MfmSimpleNode = MfmUnicodeEmoji | MfmEmojiCode | MfmText | MfmPlain;

export type NodeType<T extends MfmNode['type']> =
	T extends 'quote' ? MfmQuote :
	T extends 'search' ? MfmSearch :
	T extends 'blockCode' ? MfmCodeBlock :
	T extends 'mathBlock' ? MfmMathBlock :
	T extends 'center' ? MfmCenter :
	T extends 'unicodeEmoji' ? MfmUnicodeEmoji :
	T extends 'emojiCode' ? MfmEmojiCode :
	T extends 'bold' ? MfmBold :
	T extends 'small' ? MfmSmall :
	T extends 'italic' ? MfmItalic :
	T extends 'strike' ? MfmStrike :
	T extends 'inlineCode' ? MfmInlineCode :
	T extends 'mathInline' ? MfmMathInline :
	T extends 'mention' ? MfmMention :
	T extends 'hashtag' ? MfmHashtag :
	T extends 'url' ? MfmUrl :
	T extends 'link' ? MfmLink :
	T extends 'fn' ? MfmFn :
	T extends 'plain' ? MfmPlain :
	T extends 'text' ? MfmText :
	never;

export function isMfmBlock(node: MfmNode): node is MfmBlock {
	switch (node.type) {
		case 'quote':
		case 'search':
		case 'blockCode':
		case 'mathBlock':
		case 'center':
			return true;
		default:
			return false;
	}
}

// block

export const QUOTE = (children: MfmNode[]): MfmQuote => ({ type: 'quote', children });

export const SEARCH = (query: string, content: string): MfmSearch => ({ type: 'search', props: { query, content } });

export const CODE_BLOCK = (code: string, lang: string | null): MfmCodeBlock => ({ type: 'blockCode', props: { code, lang } });

export const MATH_BLOCK = (formula: string): MfmMathBlock => ({ type: 'mathBlock', props: { formula } });

export const CENTER = (children: MfmInline[]): MfmCenter => ({ type: 'center', children });

// inline

export const UNI_EMOJI = (value: string): MfmUnicodeEmoji => ({ type: 'unicodeEmoji', props: { emoji: value } });

export const EMOJI_CODE = (name: string): MfmEmojiCode => ({ type: 'emojiCode', props: { name } });

export const BOLD = (children: MfmInline[]): MfmBold => ({ type: 'bold', children });

export const SMALL = (children: MfmInline[]): MfmSmall => ({ type: 'small', children });

export const ITALIC = (children: MfmInline[]): MfmItalic => ({ type: 'italic', children });

export const STRIKE = (children: MfmInline[]): MfmStrike => ({ type: 'strike', children });

export const INLINE_CODE = (code: string): MfmInlineCode => ({ type: 'inlineCode', props: { code } });

export const MATH_INLINE = (formula: string): MfmMathInline => ({ type: 'mathInline', props: { formula } });

export const MENTION = (username: string, host: string | null, acct: string): MfmMention => ({ type: 'mention', props: { username, host, acct } });

export const HASHTAG = (value: string): MfmHashtag => ({ type: 'hashtag', props: { hashtag: value } });

export const N_URL = (value: string, brackets?: boolean): MfmUrl => {
	// `brackets` exists only when it is true
	return brackets
		? { type: 'url', props: { url: value, brackets } }
		: { type: 'url', props: { url: value } };
};

export const LINK = (silent: boolean, url: string, children: MfmInline[]): MfmLink => ({ type: 'link', props: { silent, url }, children });

export const FN = (name: string, args: MfmFn['props']['args'], children: MfmFn['children']): MfmFn => ({ type: 'fn', props: { name, args }, children });

export const PLAIN = (text: string): MfmPlain => ({ type: 'plain', children: [TEXT(text)] });

export const TEXT = (value: string): MfmText => ({ type: 'text', props: { text: value } });
