# mfm.alt.js

[mfm-js](https://github.com/misskey-dev/mfm.js) と同じインターフェース・同じ出力を持つ MFM パーサを、ゼロから書き直したものです。

- 公開 API (`parse` / `parseSimple` / `toString` / `inspect` / `extract`、ノード型、ノード生成関数) は mfm-js 0.28.0 と同じです。
- どんな入力でも mfm-js と同じ構文木を返すことを目標にしています (確認方法は「互換性の確認」を参照)。
- 速度は手元の計測で mfm-js の 17〜76 倍 (絵文字だけの入力では約 3 倍) です (「速度」を参照)。

mfm-js の構文定義 (どの文字列がどのノードになるか) はそのまま踏襲し、実装だけを別物にしています。

## 使い方

mfm-js と同じです。

```ts
import * as mfm from 'mfm.alt.js';

const nodes = mfm.parse('**Hello** $[tada world] :emoji: #tag');
const text = mfm.toString(nodes);
```

既存のプロジェクトでは、npm alias で `mfm-js` をこのパッケージに向ければ import を書き換えずに差し替えられます
(公開する場合のパッケージ名は未定です。`package.json` は現在 `private` にしてあります)。

## 設計

mfm-js はパーサコンビネータ (小さなパーサを `seq` / `alt` / `many` で組み合わせる方式) で書かれています。
読みやすい反面、1 文字ごとに複数の関数呼び出し・結果オブジェクト・配列が発生します。
mfm.alt.js は同じ文法を手書きの再帰下降パーサに落とし込んで、これらを無くしています。

| | mfm-js | mfm.alt.js |
| --- | --- | --- |
| 構文の表現 | コンビネータの組み合わせ | 構文ごとに 1 関数 ([src/parser.ts](src/parser.ts)) |
| 解析結果の受け渡し | `{ success, value, index }` を毎回生成 | 戻り値は「読み終えた位置」の数値だけ。ノードはモジュール変数 `node` に置く |
| テキスト | 1 文字ずつ文字列にして最後に結合 | 入力上の範囲 (開始・終了位置) で持ち、ノードの手前でまとめて `slice` する |
| 次に試す構文の決め方 | 先頭文字ごとの候補リストを順に試す | 文字種の表 (`Uint8Array`) と `switch` |
| 普通の文字の連続 | 1 文字ずつ全構文を試す | 「何の構文も始まらない文字」をまとめて読み飛ばす |
| Unicode 絵文字 | 巨大な正規表現を毎回実行 | 同じ正規表現をトライ木に変換して辿る ([src/emoji.ts](src/emoji.ts)) |

### ファイル構成

| ファイル | 内容 |
| --- | --- |
| [src/parser.ts](src/parser.ts) | パーサ本体。`fullParser` / `simpleParser` |
| [src/emoji.ts](src/emoji.ts) | Unicode 絵文字のマッチャ |
| [src/node.ts](src/node.ts) | ノードの型と生成関数 (mfm-js と同じ形) |
| [src/stringify.ts](src/stringify.ts) | 構文木 → MFM 文字列 |
| [src/api.ts](src/api.ts), [src/index.ts](src/index.ts) | 公開 API |
| [test/](test/) | テスト。`parser.ts` と `api.ts` は mfm-js のテストスイートそのまま |
| [compare/](compare/) | mfm-js のビルドと結果・速度を比べる道具 ([compare/README.md](compare/README.md)) |

### 絵文字のマッチャ

mfm-js は `@misskey-dev/emoji-data` の `emojiRegex` を各位置で実行します。この正規表現は数千の絵文字を表す巨大な選択 (`a|b|c|...`) です。
mfm.alt.js は同じ `emojiRegex` のソースを読み、トライ木 (文字ごとに枝分かれする木) に変換して辿ります。絵文字の一覧を自前で持たないので、emoji-data を更新すればそのまま追従します。

- 正規表現は「最初にマッチした選択肢」を返します (最長一致ではありません)。トライ木の各終端に「正規表現がその文字列へ到達する順番」を持たせて、同じ結果を返すようにしています。
- 対応している構文は、`emojiRegex` が使っている範囲 (選択、グループ、文字クラス、`?`、1 文字の否定先読み) です。それ以外の構文が現れたら、トライ木を諦めて正規表現をそのまま使います (結果は同じで、速度だけ落ちます)。
- 木は入力が到達した節点から少しずつ作るので、初回のパースで全体の構築を待つ必要はありません。

### mfm-js の「nest budget」

mfm-js は細工された入力で時間が爆発しないよう、ネストの試行回数に上限 (入力長 × 20 + 1000) を持っています。通常の入力では使い切りませんが、使い切るとそれ以降はネストせず文字として読むので、結果に影響します。
mfm.alt.js はこの回数を mfm-js と同じ箇所で数えています。普通の文字をまとめて読み飛ばすときも、mfm-js が 1 文字ごとに使う分をまとめて引いています。`<center>` とリンクについては、mfm-js が持つ失敗位置のメモも同じ内容で再現しています (メモに当たるとネストの試行が省かれ、回数に影響するためです)。

## 互換性の確認

| 確認 | 内容 | 結果 |
| --- | --- | --- |
| mfm-js のテストスイート | `test/parser.ts` と `test/api.ts` をそのまま実行 | 222 件すべて成功 |
| 差分 fuzz (API) | ランダムな入力で `parse` / `parseSimple` / `toString` を mfm-js (develop `be3c1db`) と比較 | 異なる入力 約 147 万件で不一致 0 |
| 差分 fuzz (nest budget) | 上限を入力ごとに小さな値へ差し替えて、ネストを途中で打ち切る経路を比較 | 異なる入力 約 147 万件で不一致 0 |
| 細工した入力 | 同じ記号の繰り返しなど 37 種 × 3 サイズで、結果の一致と所要時間を比較 | すべて一致。時間は入力長にほぼ比例 |
| 絵文字のマッチャ | `emojiRegex` そのものと比較 (全コードユニット × 典型的な後続、ランダム列、壊した絵文字)。構文の小さな正規表現をランダムに作って比較 | すべて一致 |

fuzz の件数は「異なる入力の数」です。手順は [compare/README.md](compare/README.md) にあります。

### mfm-js と異なる点

- **深すぎるネストでのスタック溢れ**: `nestLimit` に極端に大きな値を渡して数千段のネストを解析させると、mfm-js は `RangeError` (スタック溢れ) を投げます。mfm.alt.js は 1 段あたりの関数呼び出しが少ないので、もっと深くまで解析できます。溢れる深さが違うだけで、どちらも溢れなければ結果は同じです。既定の `nestLimit` (20) では起きません。
- **内部 API**: mfm-js の `src/internal` (コンビネータ) に相当するものはありません。公開 API だけが互換の対象です。
- **CLI**: mfm-js の `src/cli` (対話パーサ) は移植していません。

## 速度

`parse` 1 回あたりの時間 (µs、小さいほど速い)。Node.js v24.20.0、`node compare/bench.mjs` の結果です。

| 入力 | 文字数 | base | pr1-stage1 | pr1 | alt | alt / base | alt / pr1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plainJa (日本語の平文) | 150 | 38.0 | 4.23 | 0.56 | 0.50 | 76 倍 | 1.1 倍 |
| plainEn (英語の平文) | 196 | 54.6 | 10.4 | 0.82 | 0.84 | 65 倍 | 1.0 倍 |
| typical (よくあるノート) | 189 | 42.5 | 19.9 | 7.29 | 1.93 | 22 倍 | 3.8 倍 |
| long (長文) | 4240 | 1197 | 365 | 90.9 | 35.5 | 34 倍 | 2.6 倍 |
| mfmArt (`$[...]` の入れ子) | 1860 | 400 | 246 | 81.2 | 23.7 | 17 倍 | 3.4 倍 |
| emojiHeavy (絵文字のみ) | 840 | 34.0 | 32.4 | 25.7 | 10.3 | 3.3 倍 | 2.5 倍 |
| codeBlock | 2809 | 141 | 33.2 | 8.31 | 7.29 | 19 倍 | 1.1 倍 |
| centerArt (`<center>` 内に装飾) | 1158 | 191 | 111 | 39.3 | 10.3 | 19 倍 | 3.8 倍 |
| quoteNested (引用の入れ子) | 410 | 173 | 97.4 | 72.7 | 9.65 | 18 倍 | 7.5 倍 |
| digitsAndSymbols (数字と記号の多いログ風) | 850 | 294 | 125 | 25.6 | 12.7 | 23 倍 | 2.0 倍 |

- `base`: mfm-js develop (`be3c1db`)
- `pr1-stage1` / `pr1`: [samunohito/mfm.js#1](https://github.com/samunohito/mfm.js/pull/1) の第 1 段 (`9127e00`) と最新 (`6f2b78c`)。mfm-js のコンビネータを保ったまま高速化したもの
- `alt`: mfm.alt.js

入力は [compare/inputs.mjs](compare/inputs.mjs) にあります。

### 速度以外の比較

| | mfm-js (base) | mfm-js PR#1 | mfm.alt.js |
| --- | --- | --- | --- |
| ESM バンドル (未圧縮 / gzip) | 29.6 kB / 6.8 kB | 35.5 kB / 8.3 kB | 44.1 kB / 11.6 kB |
| import 後の初回 `parse` (絵文字 1 個を含む短文) | 約 2.5 ms | 約 2.8 ms | 約 4.2 ms |
| nest budget を使い切る入力での結果 | (基準) | 変わることがある | 同じ |

初回が遅いのは、`emojiRegex` のソースを読んでトライ木の根を作る処理が入るためです (mfm-js も初回は正規表現のコンパイルが入ります)。2 回目以降は同じ短文で mfm-js 約 0.15 ms に対し約 0.05 ms です。

## 開発

```sh
pnpm install
pnpm build     # built/ に出力
pnpm test      # vitest + tsd
pnpm tsc       # 型チェック
pnpm lint      # oxlint
```

## ライセンス

MIT。mfm-js から持ってきたファイル (テストスイートなど) については [LICENSE](LICENSE) を参照してください。
