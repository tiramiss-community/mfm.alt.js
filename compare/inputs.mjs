// Inputs for the benchmark.
const ja = 'きょうはいい天気ですね。散歩に行ってきました、公園の桜がとてもきれいでした。明日も晴れるといいなあ。';

export const inputs = {
	// about 150 characters without any syntax
	plainJa: ja.repeat(3),
	plainEn: 'The quick brown fox jumps over the lazy dog. This is a typical short english note without markup. '.repeat(2),
	typical: '@alice@example.com おはよう！ :blobcat_wave: 今日の #misskey 開発メモ 🎉\n**太字** と <i>斜体</i> と ~~取り消し~~\nhttps://example.com/path?q=1 を見てね。\n$[x2 でかい] $[spin.speed=2s 回る]\n> 引用です\n> 二行目\n`inline code` 😀👍🏽',
	// about 4000 characters
	long: (ja + '\n' + '@bob 見て https://example.org/a_(b) #タグ :emoji: **bold** ').repeat(40),
	mfmArt: '$[x2 $[bg.color=f00 $[fg.color=fff $[spin :a: $[flip :b:]]]]]\n'.repeat(30),
	emojiHeavy: '😀🎉👍🏽🇯🇵👨‍👩‍👧‍👦❤️✨🔥'.repeat(30),
	codeBlock: '```js\n' + 'const x = 1; // comment *not* bold\n'.repeat(80) + '```',
	centerArt: '<center>\n' + '$[x2 **:blobcat:** ようこそ] [リンク](https://example.com) と文章。\n'.repeat(20) + '</center>',
	quoteNested: ('> > > 深い引用 **太字** :emoji:\n> > 中くらい\n> 浅い\n\n').repeat(10),
	digitsAndSymbols: '2026-11-13 12:34:56 [INFO] request #1024 took 3.5ms (cache=hit, size=42kB) *ok* 100%\n'.repeat(10),
};
