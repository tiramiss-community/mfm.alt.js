# mfm.alt.js

[mfm-js](https://github.com/misskey-dev/mfm.js) と同じインターフェース・同じ出力を持つ MFM パーサを、ゼロから書き直したものです。

- 公開 API (`parse` / `parseSimple` / `toString` / `inspect` / `extract`、ノード型、ノード生成関数) は mfm-js 0.28.0 と同じです。
- どんな入力でも mfm-js と同じ構文木を返すことを目標にしています (確認方法は「互換性の確認」を参照)。
- 速度は手元の計測で mfm-js の 18〜107 倍 (絵文字だけの入力では約 3.5 倍) です (「速度」を参照)。

mfm-js の構文定義 (どの文字列がどのノードになるか) はそのまま踏襲し、実装だけを別物にしています。

## 使い方

mfm-js と同じです。

```ts
import * as mfm from '@tiramiss-community/mfm.alt.js';

const nodes = mfm.parse('**Hello** $[tada world] :emoji: #tag');
const text = mfm.toString(nodes);
```

公開パッケージ名は `@tiramiss-community/mfm.alt.js` です。
既存のプロジェクトでは、npm alias で `mfm-js` をこのパッケージに向ければ import を書き換えずに差し替えられます。

```sh
pnpm add mfm-js@npm:@tiramiss-community/mfm.alt.js
```

## 設計

mfm-js はパーサコンビネータ (小さなパーサを `seq` / `alt` / `many` で組み合わせる方式) で書かれています。
読みやすい反面、1 文字ごとに複数の関数呼び出し・結果オブジェクト・配列が発生します。
mfm.alt.js は同じ文法を手書きの再帰下降パーサに落とし込んで、これらを無くしています。

| | mfm-js | mfm.alt.js |
| --- | --- | --- |
| 構文の表現 | コンビネータの組み合わせ | 構文ごとに 1 関数 ([src/parser/](src/parser/)) |
| 解析結果の受け渡し | `{ success, value, index }` を毎回生成 | 戻り値は「読み終えた位置」の数値だけ。ノードは共有の状態 `state.node` に置く |
| テキスト | 1 文字ずつ文字列にして最後に結合 | 入力上の範囲 (開始・終了位置) で持ち、ノードの手前でまとめて `slice` する |
| 次に試す構文の決め方 | 先頭文字ごとの候補リストを順に試す | 文字種の表 (`Uint8Array`) と `switch` |
| 普通の文字の連続 | 1 文字ずつ全構文を試す | 「何の構文も始まらない文字」をまとめて読み飛ばす |
| Unicode 絵文字 | 巨大な正規表現を毎回実行 | 同じ正規表現をトライ木に変換して辿る ([src/emoji/](src/emoji/)) |

### ファイル構成

| ファイル | 内容 |
| --- | --- |
| [src/parser/](src/parser/) | パーサ本体。入口は [index.ts](src/parser/index.ts) の `fullParser` / `simpleParser` |
| 　[state.ts](src/parser/state.ts) | 構文の関数どうしで共有する解析中の状態 (`state`) |
| 　[chars.ts](src/parser/chars.ts) | 文字コードと文字種の表 |
| 　[memo.ts](src/parser/memo.ts) | 細工された入力で時間が爆発しないための、入力ごとのメモ |
| 　[helpers.ts](src/parser/helpers.ts) | 改行・行頭行末・nest budget・平文の連続の読み飛ばし |
| 　[sequence.ts](src/parser/sequence.ts) | 項目の並び (入力全体、インライン構文の中身、`<center>` とリンクのラベル) |
| 　[dispatch.ts](src/parser/dispatch.ts) | 位置の文字から試す構文を選ぶ (順番は mfm-js と同じ) |
| 　[block.ts](src/parser/block.ts) | ブロック構文: 引用、コードブロック、数式ブロック、center、検索 |
| 　[inline.ts](src/parser/inline.ts) | インライン構文: 絵文字、太字・斜体、plain、fn、インラインコード、数式 |
| 　[link.ts](src/parser/link.ts) | 参照系のインライン構文: メンション、ハッシュタグ、URL、リンク |
| [src/emoji/](src/emoji/) | Unicode 絵文字のマッチャ。入口は [index.ts](src/emoji/index.ts) |
| 　[regexp.ts](src/emoji/regexp.ts) | `emojiRegex` のソースを読む (使われている構文の範囲だけ) |
| 　[trie.ts](src/emoji/trie.ts) | 読んだ正規表現からトライ木を作り、入力と照合する |
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

| 入力 | 文字数 | mfm-js | mfm.alt.js | 比 |
| --- | ---: | ---: | ---: | ---: |
| plainJa (日本語の平文) | 150 | 35.8 | 0.34 | 107 倍 |
| plainEn (英語の平文) | 196 | 48.5 | 0.67 | 72 倍 |
| typical (よくあるノート) | 189 | 41.5 | 1.86 | 22 倍 |
| long (長文) | 4240 | 1173 | 32.2 | 36 倍 |
| mfmArt (`$[...]` の入れ子) | 1860 | 382 | 21.3 | 18 倍 |
| emojiHeavy (絵文字のみ) | 840 | 33.3 | 9.62 | 3.5 倍 |
| codeBlock | 2809 | 127 | 6.52 | 20 倍 |
| centerArt (`<center>` 内に装飾) | 1158 | 188 | 9.13 | 21 倍 |
| quoteNested (引用の入れ子) | 410 | 175 | 8.56 | 20 倍 |
| digitsAndSymbols (数字と記号の多いログ風) | 850 | 285 | 12.0 | 24 倍 |

mfm-js は develop (`be3c1db`) をビルドしたものです。
入力は [compare/inputs.mjs](compare/inputs.mjs) にあります。

### 速度以外の比較

| | mfm-js | mfm.alt.js |
| --- | --- | --- |
| ESM バンドル (未圧縮 / gzip) | 29.6 kB / 6.8 kB | 46.3 kB / 12.0 kB |
| 常駐メモリ (import + 初回 parse + emoji-data の全絵文字を一度ずつ parse) | 約 0.45 MB | 約 1.0 MB |
| import 後の初回 `parse` (絵文字 1 個を含む短文) | 約 2.6 ms | 約 4.0 ms |

常駐メモリは `node compare/footprint.mjs` で測ったものです。mfm.alt.js は絵文字のトライ木を持つ分だけ多く、全絵文字を一通り読むとそれ以上は増えません。

初回が遅いのは、`emojiRegex` のソースを読んでトライ木の根を作る処理が入るためです (mfm-js も初回は正規表現のコンパイルが入ります)。2 回目以降は同じ短文で mfm-js 約 0.14 ms に対し約 0.06 ms です。

## 開発

```sh
pnpm install
pnpm build     # built/ に出力
pnpm test      # vitest + tsd
pnpm tsc       # 型チェック
pnpm lint      # oxlint
```

PRの作成・更新とmainへのpush時に、GitHub Actionsでビルド・型チェック・lint・テストと
`npm pack --dry-run` を実行します。`compare/refs` を必要とする差分fuzzテストは、
参照ビルドのないCIではスキップされます。

## リリース

### 初期設定

バージョン更新PRは標準の `GITHUB_TOKEN`、npm公開は
[Trusted Publishing (OIDC)](https://docs.npmjs.com/trusted-publishers/) を使用します。
PATや `NPM_TOKEN` の登録は不要です。

1. GitHubのSettings → Actions → General → Workflow permissionsで
   「Allow GitHub Actions to create and approve pull requests」を有効にします。
   組織の設定で禁止されている場合は、組織側でも許可してください。
2. npmの公開者に `@tiramiss-community` スコープへの公開権限を付与し、2FAを有効にします。
   パッケージが未公開の場合は、先に下記の「初回公開」を行ってください。
3. npmのパッケージ設定でTrusted PublisherとしてGitHub Actionsを登録します。

| 項目 | 値 |
| --- | --- |
| Organization or user | `tiramiss-community` |
| Repository | `mfm.alt.js` |
| Workflow filename | `publish.yml` |
| Environment | 空欄 |
| Allowed actions | `npm publish` を許可 |

workflowはGitHub-hosted runnerとNode.js 24を使用します。
Trusted Publishingにはnpm 11.5.1以上が必要です。
新規のTrusted Publisher設定は2日以内に最初の公開を成功させないと失効するため、
次のCI公開の直前に登録してください。失効した場合は削除して登録し直します。
CI公開の成功後、npmのPublishing accessを
「Require two-factor authentication and disallow tokens」に設定できます。
移行前の `RELEASE_PR_TOKEN` / `NPM_TOKEN` Secretsは不要になります。

### 初回公開

Trusted Publisherの登録には、npm上にパッケージが存在する必要があります。
未公開の場合だけ、CIに成功したmainの初回バージョン (現在は `0.1.0`) を手元から公開します。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm tsc
pnpm lint
pnpm test
npm login
npm publish --access public --tag latest --provenance=false
```

初回は対話認証と2FAを使用し、CI用のトークンは発行しません。
公開後に上記のTrusted Publisherを登録し、次のバージョンから通常の手順で公開します。
手元で公開したバージョンのGitHub Releaseを公開するとworkflowが同じ版の再公開に失敗するため、
通常の手順では新しいバージョンのReleaseを作成してください。

### 通常の手順

1. 公開パッケージに変更を加えるPRで `pnpm changeset` を実行します。
   patch / minor / major と変更内容を入力し、生成された `.changeset/*.md` をコミットします。
   CIやドキュメントだけの変更にはChangesetは不要です。
2. mainへマージすると、`Version Packages` workflowがバージョンとCHANGELOGを更新するPRを作成・更新します。
3. 更新PRの「Approve workflows to run」でCIの実行を承認し、CIと内容を確認してマージします。
   `GITHUB_TOKEN` で作成・更新されたPRのCIには書き込み権限を持つ人の承認が必要です
   ([GitHubの仕様](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs))。
   この時点ではnpmには公開されません。
4. マージ済みコミットを対象に、`package.json` のversionと一致する `v<version>` タグで
   GitHub Releaseを作成・公開します (例: `v0.1.1`)。
   CHANGELOGの該当バージョンをRelease本文に使用できます。
5. `Publish` workflowがタグのバージョンを確認し、ビルド・型チェック・lint・テストに
   成功した場合にnpmへprovenance付きで公開します。ドラフトの保存だけでは公開されません。

プレリリースはChangesetsの `pnpm changeset pre enter next` を使用してバージョンを管理し、
GitHub Releaseでも「Set as a pre-release」を選択してください。
正式版はnpmの `latest`、プレリリースは `next` タグへ公開されます。
Releaseのタグやプレリリース設定がpackage.jsonと一致しなければpublish前に失敗します。
同じバージョンは再公開できないため、公開後の変更には新しいChangesetを追加してください。

## ライセンス

MIT。mfm-js から持ってきたファイル (テストスイートなど) については [LICENSE](LICENSE) を参照してください。
