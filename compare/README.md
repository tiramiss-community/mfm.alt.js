# compare

mfm.js のビルドと結果・速度を比べるための道具です。パッケージには含めません。

## 準備

比較対象の mfm.js を git の ref からビルドして `compare/refs/` に置きます (`refs/` は git 管理外)。

```sh
# compare/build-ref.sh <mfm.js の clone> <git ref> <名前>
compare/build-ref.sh ~/develop/mfm.js be3c1db base   # 本家 develop

pnpm build                                        # mfm.alt.js 本体 (built/index.mjs)
(cd compare && pnpm exec tsdown -c tsdown.config.ts)   # 内部オプション付きのパーサ (refs/alt-internal.mjs)
```

`build-ref.sh` は `<名前>.mjs` のほかに `<名前>.budget.mjs` も作ります。これは nest budget (後述) を
`globalThis.__mfmNestBudget` で差し替えられるようにしたもので、`fuzz.mjs budget` が使います。

## スクリプト

| スクリプト | 内容 |
| --- | --- |
| `node compare/bench.mjs` | `parse` の所要時間を base と alt で比べる。`SIMPLE=1` で `parseSimple`。引数 `名前=パス ...` で対象を変えられる (例: `node compare/bench.mjs base=./refs/base.mjs other=./refs/other.mjs alt=../built/index.mjs`) |
| `node compare/fuzz.mjs api [件数] [seed] [最大トークン数]` | ランダム入力で `parse` / `parseSimple` / `toString` の結果が base と一致するか調べる |
| `node compare/fuzz.mjs budget [件数] [seed] [最大トークン数]` | nest budget を小さくして、ネストを途中で打ち切る経路でも結果が一致するか調べる |
| `node compare/stress.mjs` | 細工した入力 (同じ記号の繰り返しなど) で、入力長に対して時間が跳ね上がらないことと、結果の一致を調べる |

- fuzz の比較対象は環境変数 `BASE` (refs 内の名前) で変えられます。既定は `base`。
- fuzz の乱数は mulberry32 です。件数とあわせて「異なる入力の数」を表示するので、報告にはそちらを使ってください。
- `pnpm vitest` に含まれる `test/compat.ts` は、`refs/base.mjs` と `refs/base.budget.mjs` があるときだけ同じ比較を少量 (各 3 万件) 実行します。

## nest budget について

mfm.js は細工された入力で時間が爆発しないよう、ネストの試行回数に上限 (入力長 × 20 + 1000) を持っています。
通常の入力では使い切りませんが、使い切ると以降はネストせず文字として読むので、結果が変わります。
mfm.alt.js はこの回数を mfm.js と同じ箇所で数えるので、上限に達する入力でも結果が一致します。
`fuzz.mjs budget` は上限を入力ごとに小さな値へ差し替えて、この一致を確かめます。
