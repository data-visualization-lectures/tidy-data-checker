# Unit 4 設計書：値のクリーニング（手順6〜9）

この文書は Unit 4 の **設計のみ** を扱います。この文書を追加した時点では `src/` は一切変更していません。

対象は、チェックリストで「未実装」と表示されている次の4ステップです（番号は `src/checks/registry.ts` の並び順）。

| 手順 | id | 名前 | 新しいチェック |
|---|---|---|---|
| 6 | `totals` | 合計・小計行 | `totalsCheck`（`src/checks/totals.ts`） |
| 7 | `symbols` | 値の中の記号 | `symbolsCheck`（`src/checks/symbols.ts`） |
| 8 | `format-number` | 全角数字・桁区切り・単位 | `formatNumberCheck`（`src/checks/formatNumber.ts`） |
| 9 | `wareki` | 和暦などの日付 | `warekiCheck`（`src/checks/wareki.ts`） |

手順10（横持ち→縦持ち、Unit 5）と Python エクスポート（Unit 6）は、この4ステップで整えた表を受け取る側として、引き継ぎ事項だけを書きます（9章）。

---

## 0. 要約

- **型（`src/types/index.ts`）は変更しない。** 既存の `Check` / `Finding` / `Fix` / `CheckContext` だけで4ステップとも表現できる。
- **ユーザーに選ばせる場面は「主修正 = `warning` + `fix`」「代替案 = `info` + `fix`」の2つの Finding で表す。** `info` は件数に数えられず（`deriveCheckpointStatus`）、`FindingItem` は severity に関係なく `fix` があればボタンを出すので、既存 UI のままで「おすすめ」と「別の方法」を並べられる。
- 新規ファイルは共通ユーティリティ4つ（`dataRegion.ts` / `values.ts` / `cellEdit.ts` / `japaneseDate.ts`）とチェック4つ。4チェックが同じ「データ行はどこか」「この列は数値列か」を必要とするため、共通化は避けられない最小限と判断した。
- **前提修正が1つ必要。** 実データ風の表で既存の手順1〜5を実行したところ、「単位：事業所」の行がどの修正でも消えず、手順5がそれを見出しの一部として「単位：事業所_都道府県」に統合してしまうことを確認した（1.2節）。手順4で単位行を削除できるようにする（3.7節、PO 確認事項 Q3）。
- 実装は 13 のサブユニットに分ける（10章）。PO に確認したいことは4つ（11章）。

---

## 1. 既存実装の確認結果

### 1.1 仕組みの要点

| 仕組み | 場所 | Unit 4 での使い方 |
|---|---|---|
| チェック登録 | `registry.ts` の `checkpointRegistry`。`check: null` が「未実装」。`getImplementedChecks()` が registry 順に `Check` を返し、`checks/index.ts` の `checks` になる | 4つの `check: null` を新しいチェックに差し替えるだけで、チェック実行・チェックリスト・結果パネルに載る |
| チェック結果 | `Finding { checkId, severity, ranges, message, fix?, metadata? }` | そのまま使う。`metadata` に Unit 6 用の構造化情報を入れる |
| 修正 | `Fix { description, apply, deletedRows?, deletedCols?, encodingConversion? }`。`apply` は純粋関数 | 行・列の削除は `deletedRows` / `deletedCols` を必ず設定する（結合セル情報の調整に使われる） |
| プレビュー | `useTableState.previewFix` が `fix.apply(state.table)` を計算し、`FixPreview` が修正前後を並べる。修正前のグリッドだけ `finding.ranges` を強調する | セルの値だけ変わる修正（手順7〜9）は、修正後のグリッドでも強調したい（サブユニット U4-11） |
| 適用 | `applyFix` が現在の表を `history` に積み、`deletedRows/Cols` で `mergedCells` を調整し、**全チェックを再実行**する | 修正の結果は再検出で自然に消える。各チェックは「修正後に同じ問題を再検出しない」ことが必須（冪等性） |
| 元に戻す | `undo` が `history` の表を戻して全チェックを再実行する | 追加の仕組みは不要 |
| ステータス | 件数に数えるのは `(error または warning) かつ fix あり`。`fixed` は読み込み時の `buildFixHistory` と比べて判定 | 代替案を `info` にすれば件数が二重にならない |
| 表示 severity | `getDisplaySeverity`: fix のない warning / error は「情報」と表示 | 「判断できない記号」などは fix なし `info` で出す |
| 文字コード未修正時 | `previewFix` が手順1以外の修正を止め、パネルは「手順1のあと」と表示 | 何もしなくてよい |
| データモデル | `Table = string[][]`。CSV は Papa Parse の結果そのまま。Excel は `cell.v`（生の値）を `String()` したもの | Excel の数値は桁区切りが付かない。Excel の日付はシリアル値（例 `45017`）になる（12章） |
| `ctx.detectedUnit` | `titleNotesCheck` が `ctx` に書き込み、同じ実行内の後続チェックから読める | 手順8のメッセージで参照できるが、Unit 4 では依存しない |
| テスト | vitest + jsdom。各テストファイルに `createContext()` を置き、`findings.find(f => f.message.includes('…'))` で探し、`fix.apply` の結果と元の表が変わらないこと（純粋性）を確かめる。フィクスチャは `readFileSync` + `parseCSVWithMeta`、生成は `scripts/create-fixtures.js` | 同じ書き方で書く |

ベースライン：`npm test` で 12 ファイル・114 件すべて成功（この設計の作業開始時に確認）。

### 1.2 実測で見つかった既存の問題（Unit 4 に影響する）

次の CSV に対して既存の手順1〜5を「最初に出た修正を順に適用」で実行した。

```csv
表1 都道府県別事業所数（平成30年～令和2年）
単位：事業所

都道府県,平成30年,令和元年,令和2年
全国,"１，２３４","1,300",△10
北海道,500,x,…
青森県,734,-,"1,310※"
注：x は秘匿、… は不詳、△ は減少
出典：架空統計
```

結果：

1. 空行・タイトル行・注記行は消えるが、**単位行「単位：事業所」はどの修正でも消えない**（手順4の単位行は fix のない `info` だけ）。
2. その状態で手順5が「2行の多段ヘッダー」を検出し、適用すると見出しが **`単位：事業所_都道府県`** になる。
3. その後、手順4が見出し行そのものを「単位行」と判定する。

Excel フィクスチャ `government-style.xlsx` の「人口」シートでも、単位行が残っている間は本当の2段見出し（人口／男・女）が検出されず、見出しの結合セルが「データ領域のセル結合」と誤判定される。単位行を削除すると正しく2段見出しとして検出される。

手順6〜9は見出し行の位置と内容を使うので、この問題を先に直す（3.7節）。

---

## 2. 設計方針

### 2.1 新しい型を足さずに「選択肢」を表す

- 主修正：`severity: 'warning'` + `fix`。件数に数えられ、チェックリストに「N件」と出る。
- 代替案：`severity: 'info'` + `fix`。件数に数えられず、結果パネルに「ℹ️ 情報」として修正ボタン付きで並ぶ。メッセージは必ず「別の方法：」で始める。
- どちらかを適用すると、再検出で元の問題が消えるため、もう一方も自動的に消える。代替案の結果（例：注記列）が再検出されないよう、各チェックにガードを入れる（5.2節）。

### 2.2 セル編集の Fix

手順7〜9の修正は「特定のセルを特定の値に書き換える」形にそろえる。検出時に `{ row, col, value }` の一覧を作って `Fix` に閉じ込め、`apply` では行をコピーしてから書き換える（`empty.ts` が削除対象の行番号を閉じ込めているのと同じ考え方）。共通関数は `src/utils/cellEdit.ts`（3.4節）。

### 2.3 列を足すときは右端に足す

注記列（手順7の代替案）は、元の列の隣ではなく **表の右端** に追加する。隣に挿入すると右側の結合セル座標がずれ、`Fix` に「挿入した列」を表す項目を足す必要が出るため。右端なら既存の `mergedCells` はそのまま正しい。

### 2.4 全角→半角は独自の変換表で行う（NFKC を使わない場面がある）

`String.prototype.normalize('NFKC')` は `²`→`2`、`℃`→`°C`、`㎡`→`m2`、`¹`→`1` に変える（実測）。数値や単位を書き換える手順7・8でこれを使うと、`1121.26km²` が `1121.26km2` に、注記の上付き数字 `1,234¹` が `12341` になってしまう。

- 手順7・8：`toHalfWidth`（3.3節）。全角 ASCII ブロック U+FF01〜U+FF5E を半角に、U+3000 を半角空白に、U+2212（−）と U+2010（‐）を `-` に置き換えるだけ。**どれも1文字→1文字** なので、半角化した文字列で見つけた位置で元の文字列をそのまま切り出せる（全角のまま残したい部分を壊さない）。
- 手順6（ラベル判定）と手順9（日付判定）：判定にだけ `NFKC` + 空白除去を使う（`nfkcCompact`）。`㍻`→`平成`、`㋿`→`令和`、`総　数`→`総数` を拾えるため。書き換え後の値は判定結果から組み立てるので、NFKC の副作用は出力に出ない。

### 2.5 データ領域（見出し行とデータ行）の決め方

4チェックとも「見出し行」「データ行」を区別する必要がある。手順4・5が未適用でも誤動作しないよう、既存の判定関数を再利用する（3.2節 `getDataRegion`）。タイトル行・単位行・注記行・空行はデータ行として扱わない。

### 2.6 列の種類の決め方

手順6〜8は「数値の列」「コードの列」「日付の列」「文字の列」を区別する（3.3節 `classifyColumns`）。特に **コード列（`01`、`00000` など）は数値として扱わない**。表は文字列のまま保持しているので先頭の 0 が消えることはないが、桁区切り除去・単位の移動・記号の置換の対象から外す。

### 2.7 冪等性と収束性

- **冪等性**：どの Fix も、適用した直後に同じチェックを再実行すると、その種類の問題は 0 件になる。もう一度同じ処理をしても表は変わらない。
- **収束性**：手順6〜9の修正をどの順で適用しても、最終的な表は同じになる（例：手順8を先にしても、手順7で `1,310※` が `1,310` になった時点で手順8が再検出して `1310` にする）。統合テストで確かめる（U4-12）。

### 2.8 実装上の制約

- `tsconfig` の `lib` は `ES2020`。`String.prototype.replaceAll`、`Array.prototype.at`、正規表現の `d` フラグは使わない。`u` フラグ、名前付きグループ、後読み `(?<=…)` は使ってよい。
- ESLint の `no-irregular-whitespace` は文字列と正規表現を除外しているので、全角空白をパターンに書いてよい。
- 列番号の表示は `toColLetter`（`src/utils/cellRef.ts`）を使う。`empty.ts` の `String.fromCharCode(65 + i % 26)` は27列目以降で誤るので真似しない。
- メッセージは既存と同じく「N 個の〜が見つかりました」「（行 2, 7）」の形。数の前後に半角空白を入れる。
- セル単位の Finding は、同じ列で縦に連続するセルを1つの `CellRange` にまとめる（`DataGrid` は全セル×全 range を照合するため、range が多いと重くなる）。
- 1つのチェックは表全体を1回走査する O(行×列) にし、正規表現はモジュールの先頭で1回だけ作る。

---

## 3. 共通基盤

### 3.1 既存ファイルの変更

| ファイル | 変更 |
|---|---|
| `src/checks/titleNotes.ts` | `classifyRow`、`findDataStartRow`、`findDataEndRow` に `export` を付ける（中身は変えない）。単位行の削除 Fix を追加（3.7節） |
| `src/checks/multiHeader.ts` | `analyzeHeaders` に `export` を付ける（中身は変えない） |
| `src/utils/cellRef.ts` | `formatRowList`、`formatColList`、`cellsToRanges` を追加 |
| `src/checks/registry.ts` | 4つの `check: null` を差し替え。`totals` と `symbols` の説明文を少し直す（10章 U4-13） |
| `src/checks/index.ts` | 4チェックを `export` に追加 |
| `src/__tests__/registry.test.ts` | 未実装の例を `totals` などから `wide-to-long` / `final` だけに変更 |
| `src/__tests__/checkpointStatus.test.ts` | `deriveAllCheckpointStates` の「未実装」の例を `totals` から `wide-to-long` に変更（`deriveCheckpointStatus('totals', [], false)` は引数で未実装を渡しているのでそのままでよい） |

`src/types/index.ts`、`src/hooks/useTableState.ts`、`src/components/*`（U4-11 の `FixPreview.tsx` 1か所を除く）は変更しない。

### 3.2 `src/utils/dataRegion.ts`（新規）

```ts
import type { Table } from '../types';

export interface DataRegion {
  headerRows: number[];  // 見出し行（多段なら上から順に。必ず1行以上）
  headerRow: number;     // 見出しの最下段（列名として扱う行）
  firstDataRow: number;  // 最初のデータ行
  lastDataRow: number;   // 最後のデータ行（この行を含む）。データがなければ firstDataRow - 1
  maxCols: number;
}

export function getDataRegion(table: Table): DataRegion;

/** firstDataRow〜lastDataRow の範囲にあり、空行でない行 */
export function isDataRow(table: Table, row: number, region: DataRegion): boolean;

/** 見出しの各段を上から "_" でつないだ列名（multiHeader の flattenHeaders と同じ規則。空なら `列${col + 1}`） */
export function getColumnLabel(table: Table, col: number, region: DataRegion): string;
```

決め方（既存の判定関数を組み合わせるだけで、新しい判定は足さない）：

1. `start = findDataStartRow(table)`（titleNotes。タイトル行・単位行を飛ばした最初の「データらしい行」= 見出しの1段目）
2. `count = max(1, analyzeHeaders(table.slice(start)).headerRows.length)`（multiHeader。結合セル情報は渡さない）
3. `headerRows = [start, …, start + count - 1]`、`headerRow = start + count - 1`、`firstDataRow = headerRow + 1`
4. `lastDataRow = max(findDataEndRow(table), headerRow)`（titleNotes。末尾の注記行を除く）

範囲内の行を `classifyRow` で再判定はしない。`classifyRow` は空でないセルが2つ以下の行で `/\d{4}年度?/` をタイトルとみなすため、`["2023年度", "100"]` のような2列のデータ行がタイトル扱いになってしまうから。範囲内では空行だけを除く。

確認済みの動き（既存関数を一時スクリプトで実行）：`government-style.xlsx` の「人口」シートは、タイトル行・単位行が残ったままでも `headerRows = [2, 3]`、データ = 行 4〜7（0始まり）になる。

### 3.3 `src/utils/values.ts`（新規）

```ts
import type { Table } from '../types';
import type { DataRegion } from './dataRegion';

/** 全角 ASCII（U+FF01〜U+FF5E）→半角、U+3000→空白、U+2212/U+2010→'-'。1文字→1文字の置換 */
export function toHalfWidth(s: string): string;

/** 判定専用：NFKC 正規化し、すべての空白を除く */
export function nfkcCompact(s: string): string;

export interface ParsedNumber {
  sign: '' | '+' | '-';
  digits: string;            // 半角・桁区切りなし。例 "1234.5"
  multiplier: '' | '千' | '万' | '億' | '兆';
  unit: string;              // 元の表記のまま。例 "人", "km²", "%"
  hasFullWidth: boolean;     // 全角の数字・記号を含む
  hasPadding: boolean;       // 前後に空白がある
  hasSeparator: boolean;     // 正しい3桁区切りのカンマを含む
}
export function parseNumericCell(raw: string): ParsedNumber | null;

export type SymbolKind = 'missing' | 'dash' | 'negative' | 'marker' | 'unknown';
export interface SymbolMatch {
  kind: SymbolKind;
  replacement: string;       // 主修正を適用した後の値（unknown は raw のまま）
}
export function matchSymbol(raw: string): SymbolMatch | null;

export type ColumnKind = 'numeric' | 'code' | 'date' | 'text' | 'empty';
export function classifyColumns(table: Table, region: DataRegion): ColumnKind[];

export const CODE_HEADER_RE: RegExp;
export const DATE_HEADER_RE: RegExp;

/** 小数の文字列を 10^exponent 倍する（浮動小数点を使わない）。例 ("1.2", 4) → "12000" */
export function shiftDecimal(digits: string, exponent: number): string;
```

#### 数値セルの判定 `parseNumericCell`

前後の空白（全角空白を含む）を除き、`toHalfWidth` したうえで次に一致するかを見る。

```ts
const NUM_CORE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+`;
const NUM_RE = new RegExp(String.raw`^([+-]?)(${NUM_CORE})\s*(千|万|億|兆)?\s*(.*)$`);
const UNIT_RE = /^(?:%|‰|[A-Za-zµμ°℃/²³㎡㎞㎏]{1,6}|[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー]{1,4}(?:\/[\p{Script=Han}A-Za-z²³]{1,4})?)$/u;
const NOT_UNIT_RE = /^(?:年|年度|年次|月|月分|位)$|(?:以上|以下|未満|超|前後|程度|頃|ほど|台)$|[～〜~]/u;
```

- 末尾の残り（単位部分）が空でなければ、`UNIT_RE` に一致し、かつ `NOT_UNIT_RE` に一致しないことが条件。
- 3桁区切りは `\d{1,3}(,\d{3})+` の厳密な形だけを認める。`1,2`、`12,34` は数値とみなさない（桁区切りの誤りか、一覧の区切りかを判断できないため触らない）。
- `年`・`年度`・`月` が付くものは手順9の担当なので数値にしない。`以上`・`未満`・`～` を含むものは区分ラベル（`65歳以上`、`20～24歳`）なので数値にしない。

| 入力 | 結果 |
|---|---|
| `1,234` | digits `1234`、桁区切りあり |
| `１，２３４` | digits `1234`、全角あり・桁区切りあり |
| `  123 ` | digits `123`、前後空白あり |
| `−１２` | sign `-`、digits `12`、全角あり |
| `２４８，９８９人` | digits `248989`、unit `人`、全角あり・桁区切りあり |
| `1121.26km²` | digits `1121.26`、unit `km²` |
| `1.2万人` | digits `1.2`、multiplier `万`、unit `人` |
| `０１` | digits `01`（数値としては読めるが、コード列なら手順8は半角化だけを行う） |
| `1,2` / `12,34` / `20～24歳` / `65歳以上` / `2020年` / `第１位` / `1.5e3` | `null` |

#### 記号の判定 `matchSymbol`

判定の順番は「ダッシュ → 欠損 → マイナス → 注記マーク → 判断できない記号」。ダッシュと欠損は `nfkcCompact(raw)` に、マイナスと注記マークは `toHalfWidth(raw.trim())` に対して判定する。

```ts
const DASH_RE    = /^[-‐‑‒–—―−ー─━]+$/;
const MISSING_RE = /^(?:[xX×]{1,3}|秘匿?|秘匿値|\.{2,}|・+|不詳|不明|非公表|非公開|未調査|未集計|NA|N\/A|n\/a|n\.a\.|NaN|#N\/A|\*+|[?？]+)$/;
const NEG_RE     = new RegExp(String.raw`^[△▲▼]\s*(${NUM_CORE})\s*(.*)$`);
const MARK_PREFIX = String.raw`(?:※\d*|\*+|†|‡|#)`;
const MARK_SUFFIX = String.raw`(?:※\d*|\*+|†|‡|#|\(注\d*\)|注\d*|(?<=\d\s*)\(?[pPrR]\)?|[¹²³⁴⁵⁶⁷⁸⁹⁰]+)`;
const MARKER_RE  = new RegExp(String.raw`^(${MARK_PREFIX})?\s*([+-]?(?:${NUM_CORE})\s*[^\d\s※*†‡#(¹²³⁴⁵⁶⁷⁸⁹⁰]{0,6}?)\s*(${MARK_SUFFIX})?$`);
const UNKNOWN_RE = /^(?:[<>≦≧≤≥]|約|概ね|およそ)|(?:以上|以下|未満|超|程度|前後)$|^\(.*\)$|^[△▲▼]$/;
```

- `MARKER_RE` は前か後ろのどちらかにマークがあるときだけ一致とみなす。`p` / `r`（速報値・改訂値）は数字の直後のときだけマークとみなす（`3hr` の `r` を取らない）。
- 試作で判明した注意点：単位部分を `(?:\s*[…]{0,6}?)?` のように「省略可能なグループ」で書くと、ECMAScript ではグループが空文字に一致した回が失敗扱いになり、`123p` の `p` が単位側に取られてしまう。上の形（グループで囲まない）にすること。
- `replacement` は次のとおり。`toHalfWidth` が1文字→1文字なので、半角化後に一致した位置で元の文字列を切り出し、**全角のまま** 残す（全角の統一は手順8の仕事）。
  - `missing` / `dash` → `''`
  - `negative` → `'-'` + 記号と直後の空白を除いた残り（`▲１，２３４` → `-１，２３４`）
  - `marker` → マークを除いた数値部分（`1,234人※` → `1,234人`）
  - `unknown` → 元の値のまま（修正しない）

| 入力 | 種類 | 主修正の結果 |
|---|---|---|
| `x` `X` `ｘ` `×` `秘匿` `秘` | missing | 空欄 |
| `…` `‥` `・・・` `...` `・` `***` `*` `不詳` | missing | 空欄 |
| `-` `－` `―` `—` `ー` `−` `--` | dash | 空欄（代替案で `0`） |
| `△1.5` `▲１，２３４` `△ 10` | negative | `-1.5` `-１，２３４` `-10` |
| `1,234※` `※1,234` `123p` `456r` `789*` `1,234¹` `1,234（注１）` `＊１２３` | marker | `1,234` `1,234` `123` `456` `789` `1,234` `1,234` `１２３` |
| `<0.5` `約100` `(123)` `100以上` `△`（数字なし） | unknown | 変更しない |
| `-1,234` `0` `1234` `2.0` `※在庫限り` | 記号ではない | — |

#### 列の種類 `classifyColumns`

各列について、`isDataRow` な行の空でないセルを見る。見出しは `getColumnLabel` を `nfkcCompact` したものの最後の `_` 区切り部分。

```ts
export const CODE_HEADER_RE = /(?:コード|code|番号|識別|郵便|〒|電話|品番|型番)|^(?:no\.?|id|tel)$/i;
export const DATE_HEADER_RE = /^(?:年|年度|年次|年月|年月日|日付|日時|時点|期間|時期|調査年|調査年度|調査日|調査時点|西暦|西暦年|和暦|元号|date|year|period|fy|month)$|(?:年次|年度|年月日|年月|日付|時点)$/i;
```

1. 空でないセルが 0 → `empty`
2. 見出しが `CODE_HEADER_RE` に一致 → `code`
3. 全セルが `^[0-9０-９]+$` で、1つ以上が `0` 始まりの2桁以上 → `code`
4. 見出しが `DATE_HEADER_RE` に一致 → `date`（`青年`・`少年` のような語を拾わないよう「年」単独は完全一致のみ）
5. 数値らしいセル（`parseNumericCell` が成功、または `matchSymbol` が `negative` / `marker`）が1つ以上あり、「数値らしいセル + 記号セル（`missing` / `dash` / `unknown`）」が空でないセルの 80% 以上 → `numeric`
6. 全セルが `missing` / `dash`（全部秘匿の列など）で、ほかに `numeric` の列があり、0列目ではない → `numeric`
7. それ以外 → `text`

見出しが `_注記` で終わる列（手順7の代替案で追加した列）は常に `text`。

### 3.4 `src/utils/cellEdit.ts`（新規）

```ts
import type { Table, Fix } from '../types';

export interface CellEdit { row: number; col: number; value: string }

/** 純粋関数。編集する行だけコピーし、列が足りない行は '' で埋める */
export function applyCellEdits(table: Table, edits: CellEdit[]): Table;

export function createCellEditFix(description: string, edits: CellEdit[]): Fix;
```

### 3.5 `src/utils/cellRef.ts` への追加

```ts
/** 0始まりの行番号 → "行 2, 7, 8"。max 件を超えたら "行 2, 7, 8 ほか 12 行" */
export function formatRowList(rows: number[], max?: number): string;   // 既定 max = 10

/** 0始まりの列番号 → "列 B, D"（toColLetter を使う） */
export function formatColList(cols: number[], max?: number): string;   // 既定 max = 10

/** 同じ列で縦に連続するセルを1つの CellRange にまとめる */
export function cellsToRanges(cells: Array<{ row: number; col: number }>): CellRange[];
```

### 3.6 `src/utils/japaneseDate.ts`（新規）

手順9の7.2節で定義する。手順11（型の最終確認）でも使える独立した純粋関数として置く。

### 3.7 前提修正：手順4で単位行を削除できるようにする

- `titleNotesCheck` の単位行 Finding（現在は `info`、fix なし）を `warning` + fix に変える。`metadata.units` と `ctx.detectedUnit` の設定はそのまま残す。
- 削除の対象は「空でないセルが2つ以下」の単位行だけにする。`classifyRow` は `UNIT_PATTERNS` を行の内容全体に当てるので、`["都道府県", "人口（単位：人）"]` のような **見出し行も単位行と判定されうる**。そのまま削除対象にすると見出しが消えるため、このガードは必須。
- メッセージ：`単位行が見つかりました（行 2「単位：事業所」）。表の中に残っていると、見出しの判定（手順5）がずれる原因になります。`
- 修正：`単位行を削除（行 2、単位「事業所」）`。`deletedRows` を設定する。
- 単位をどこに残すかは PO 確認事項 Q3。推奨は「削除のみ（単位は修正の説明文と `metadata` に残り、Unit 6 で Python コードのコメントにできる）」。理由：`government-style.xlsx` の「単位：人」の表には単位が「世帯」の「世帯数」列もあり、全数値列の見出しに「（人）」を付けると誤りになるため。
- 既存テスト `titleNotes.test.ts` の「単位行の severity が `info`」の期待値を `warning` に直す。

---

## 4. 手順6：合計・小計行（`totals`）

### 4.1 ファイルと関数

```ts
// src/checks/totals.ts
import type { Check, Finding, Table, CheckContext, Fix } from '../types';

export type TotalKind = 'grand' | 'subtotal' | 'restated';

/** セル1つ分のラベルを判定する（テスト用に export） */
export function classifyTotalLabel(raw: string): TotalKind | null;

interface TotalRowCandidate { row: number; col: number; label: string; kind: TotalKind }
interface TotalColCandidate { col: number; label: string }

function findLabelCols(kinds: ColumnKind[]): number[];
function findTotalRows(table: Table, region: DataRegion, labelCols: number[]): TotalRowCandidate[];
function findTotalCols(table: Table, region: DataRegion, kinds: ColumnKind[]): TotalColCandidate[];
function verifyTotalRow(table: Table, region: DataRegion, cand: TotalRowCandidate, candidateRows: Set<number>, kinds: ColumnKind[]): boolean | null;
function verifyTotalCol(table: Table, region: DataRegion, cand: TotalColCandidate, kinds: ColumnKind[]): boolean | null;
function createRemoveRowsFix(rows: number[], what: string): Fix;   // empty.ts と同じ形。deletedRows を設定
function createRemoveColsFix(cols: number[]): Fix;                 // deletedCols を設定

export const totalsCheck: Check;   // id: 'totals', title: '合計・小計行'
```

### 4.2 検出ルール

#### ラベルの正規化

1. `NFKC` し、空白をすべて除く（`総　数` → `総数`）
2. 先頭の `・○◎●■□◇◆` を除く（`◎全国` → `全国`）
3. ラベル全体が `( )`、`[ ]`、`【 】`、`〔 〕`、`< >`、`「 」` で囲まれていれば外す（`（合計）` → `合計`）。ただし中身が `再掲` のときは外さない
4. 英語併記を分ける：`/^([^\x00-\x7F]+?)([A-Za-z][A-Za-z.]*)$/` に一致すれば日本語部分で判定（`計 Total` → `計`）
5. 見出しを判定するときは、さらに末尾の `（…）` を外し（`合計（人）` → `合計`）、`_` 区切りの最後の部分を使う（`人口_総数` → `総数`）

#### ラベルの分類

```ts
const GRAND_RE      = /^(?:総合計|合計|総計|総数|総額|計|全体|全国|全国計|総平均|全国平均|平均|平均値)$/;
const EN_GRAND_RE   = /^(?:grandtotal|total|all|overall)$/i;
const SUB_RE        = /^(?:小計|中計)(?:[(:：].*)?$|^.{1,10}(?:小計|合計|計)$|^計\(.+\)$/u;
const EN_SUB_RE     = /^subtotal$/i;
const RESTATED_RE   = /^\(?再掲\)?|^\(?うち[、,]?(?=[\p{Script=Han}\p{Script=Katakana}A-Za-z0-9(])/u;
const DENY_WORD_RE  = /^(?:会計|統計|設計|時計|家計|生計|推計|集計|主計|余計|早計|奇計)$/;
const DENY_SUFFIX_RE = /(?:温度|体温|血圧|湿度|速度|流量|雨量|歩数|万歩|圧力|水位|電力|照度|騒音|線量|回転|積算|距離|体重|風速|気圧|露出|酸素|放射線|ガス|水道|電気|電流|電圧|会|統|推|集)計$/;
```

判定順：`RESTATED_RE` → `GRAND_RE` / `EN_GRAND_RE` → 除外（`DENY_WORD_RE` / `DENY_SUFFIX_RE`）→ `SUB_RE` / `EN_SUB_RE`。

- `計` の前に1文字だけの除外語は、誤除外が起きないものだけにした。たとえば `生` を入れると `学生計`、`家` を入れると `農家計`、`主` を入れると `株主計` が漏れる（いずれも本当の小計）。そのため `生計`・`家計`・`主計` は完全一致でだけ除外する。
- `うち` は直後が漢字・カタカナ・英数字・括弧のときだけ（`うち女性` は対象、`うちわ` は対象外）。
- `全国`・`全国平均`・`平均` も集計行として扱う（都道府県の表で `全国` を残すと二重に数えるため）。

確認済みの判定結果（試作）：

| 判定 | ラベル |
|---|---|
| grand | `合計` `総　数` `（合計）` `計 Total` `総数 Total` `Total` `全国` `◎全国` `計` `総額` `平均` `全国平均` |
| subtotal | `小計` `小計（東北）` `東北計` `男計` `市部計` `東北小計` `男女計` `計（東北）` `年計` `累計` `学生計` `農家計` `建設業計` `株主計` |
| restated | `（再掲）政令市` `再掲：65歳以上` `うち女性` |
| 対象外 | `うちわ` `温度計` `体重計` `会計` `一般会計` `統計` `家計` `推計` `人口推計` `集計` `計画` `設計` `時計` `北海道` `平均気温` |

#### 集計行（ラベルが行の左側にある場合）

- **ラベル列**：0列目は常に含める。1〜2列目は種類が `text` / `code` / `date` なら含める（`都道府県コード, 都道府県, 人口` のように、コード列の右にラベルがある e-Stat 形式に対応。`年, 人口` で最終行が `合計` の表にも対応）。
- データ行のラベル列のセル（セル全体）を `classifyTotalLabel` で判定する。見出し行は対象外。
- **誤検出のガード**
  - ある列で、空でない値がすべて同じ集計ラベル（例：全行 `全国` の全国時系列）なら、その列では検出しない。
  - ある列で、集計ラベルの行がデータ行の 50% を超えるなら、その列では検出しない（`性別` 列に `総数/男/女` が並ぶ縦持ちの表は 33% なので検出する）。
  - ラベル列以外に空でないセルが1つもない `再掲` の行は「見出し行」とみなし、削除の対象にしない（下の `restated-heading` を出す）。

#### 合計列（ラベルが見出しにある場合）

- `numeric` 列の列名（`getColumnLabel`）を正規化して `GRAND_RE` / `SUB_RE` で判定する（`総数`、`合計（人）`、`人口_総数`）。
- その列以外に `numeric` の列が2つ以上ないときは検出しない（`品目, 合計` のように唯一の値の列を消さないため）。

#### 検算（メッセージを強めるためだけに使い、検出の条件にはしない）

- 比べるのは、対象行と比較対象のセルがすべて `parseNumericCell` で読める `numeric` 列だけ（記号のあるセルを含む列は飛ばす）。
- 許容誤差：`|Σ − v| ≤ max(0.5 × n × 10^(−d), 0.001 × |v|)`（n = 足した行数、d = 小数点以下の最大桁数）。四捨五入で内訳の和が総数に一致しない官庁統計に合わせる。
- grand の行：ほかの集計行（grand / subtotal / restated）を除いた全データ行の和と比べる。
- subtotal の行：直上の連続したデータ行について、下から k 行（k ≥ 2）の和のどれかと一致するかを見る。一致しなければ直下の行で同じことをする（小計が先頭に来る形式）。
- 合計列：同じ行の、列名の接頭辞（`人口_`）が同じ列の和と比べる。接頭辞がなければ、合計列以外の全 `numeric` 列の和と比べる。80% 以上の行で一致すれば「一致」。
- 結果：一致した列が1つ以上あり、一致しない列が 0 なら `true`、比べられる列がなければ `null`、それ以外は `false`。

### 4.3 修正内容

種類ごとに別の Finding・別の Fix にする（「全国」は残して「小計」だけ消す、といった選び方ができるように）。どれも行または列を削除するだけで、選択肢（代替案）は設けない。

### 4.4 入出力例

例1：表の最後に合計行がある（検算一致）

```csv
品目,数量
りんご,10
みかん,20
合計,30
```
→「集計行を削除（行 4）」を適用
```csv
品目,数量
りんご,10
みかん,20
```

例2：e-Stat 風。先頭に全国、途中に地方の小計、最後に再掲（フィクスチャ `with-totals.csv`）

```csv
地域,都道府県,総数,男,女
,全国,1500,720,780
北海道,北海道,500,240,260
東北,青森県,300,140,160
東北,岩手県,250,120,130
東北,宮城県,450,220,230
東北,東北計,1000,480,520
,（再掲）政令市,200,95,105
```
→ 集計行（行 2「全国」、検算一致）・小計行（行 7「東北計」、検算一致）・再掲行（行 8）・合計列（列 C「総数」、男+女と一致）の4件。すべて適用すると：
```csv
地域,都道府県,男,女
北海道,北海道,240,260
東北,青森県,140,160
東北,岩手県,120,130
東北,宮城県,220,230
```

例3：縦持ちの表で `総数` が値として混ざっている

```csv
年,性別,人口
2020,総数,100
2020,男,48
2020,女,52
2021,総数,101
2021,男,49
2021,女,52
```
→ 集計行（行 2, 5「総数」）を削除すると、`男` と `女` の行だけが残る。

例4：誤検出しない表（フィクスチャ `totals-false-positives.csv`）

```csv
コード,項目,金額
001,一般会計,1000
002,特別会計,500
003,家計,300
004,温度計,20
005,うちわ,10
006,統計,40
```
→ 検出なし（`合計・小計行は見つかりませんでした。`）

### 4.5 Finding 一覧

| 種類 | severity | message | fix.description |
|---|---|---|---|
| 集計行 | warning | `N 個の集計行（合計・総数など）が見つかりました（行 2「全国」, 行 52「合計」）。ほかの行と一緒に集計すると二重に数えてしまうため、分析の前に除くのが基本です。` 検算一致の行があれば `行 2「全国」はほかの行の合計と一致しました。` を続ける | `集計行を削除（行 2, 52）` |
| 小計行 | warning | `N 個の小計行が見つかりました（行 7「東北計」）。小計はほかの行から計算できるので、除いておくと二重カウントを防げます。` | `小計行を削除（行 7）` |
| 再掲行 | warning | `N 個の再掲・内訳（「うち」）の行が見つかりました（行 8「（再掲）政令市」）。ほかの行の一部をもう一度数えた行なので、合計すると二重に数えてしまいます。` | `再掲行を削除（行 8）` |
| 合計列 | warning | `N 個の合計列が見つかりました（列 C「総数」）。ほかの列から計算できる値なので、横持ち→縦持ち（手順10）の前に除いておくと安全です。` | `合計列を削除（列 C）` |
| 再掲の見出し | info（fix なし） | `「（再掲）」の見出し行があります（行 9）。この下の行はほかの行と重複している可能性があるので、確認してください。` | — |
| 問題なし | info | `合計・小計行は見つかりませんでした。` | — |

- `ranges`：行は既存と同じく「その行の 0列目〜最終列」、列は「0行目〜最終行」。
- `metadata`：`{ kind: 'grand' | 'subtotal' | 'restated', rows: number[], labels: string[], verifiedRows: number[] }`、合計列は `{ kind: 'total-column', cols: number[], labels: string[], verifiedCols: number[] }`。

### 4.6 テストケース（`src/__tests__/totals.test.ts`）

1. 最終行の `合計`（0列目）を検出し、fix で行が消え、`deletedRows` が設定される
2. コード列の右（1列目）にある `全国` を検出する（e-Stat 形式）
3. `東北計` は小計として別の Finding になり、その fix は小計行だけを消す
4. `総　数`、`（合計）`、`計 Total`、`◎全国` を集計行として検出する
5. `（再掲）政令市`、`うち女性` を再掲行として検出する。`うちわ` は検出しない
6. 見出し `総数` の列を合計列として検出し、fix で列が消え、`deletedCols` が設定される
7. 平らにした見出し `人口_総数`、単位付きの `合計（人）` を合計列として検出する
8. 値の列が1つしかない表（`品目, 合計`）では合計列を出さない
9. `温度計`、`体重計`、`一般会計`、`家計`、`統計`、`推計`、`計画` を検出しない。`学生計`、`株主計` は小計として検出する
10. 全行が `全国` の列（全国時系列）では検出しない
11. 縦持ちの `性別` 列にある `総数` 行を検出する
12. 合計が内訳の和と一致するとメッセージに「一致しました」が入り、一致しなくても検出はされる
13. 見出し行の `合計` という文字は集計行として扱わない
14. 下に値のない `（再掲）` だけの行は削除対象にならず、info になる
15. 問題がなければ `合計・小計行は見つかりませんでした。` の info
16. fix は元の表を書き換えない（純粋性）
17. fix を適用した表を再検出すると、その種類の warning は 0 件（冪等性）

### 4.7 フィクスチャ

- `with-totals.csv`（例2の内容）
- `totals-false-positives.csv`（例4の内容）
- 縦持ち・全国時系列・検算不一致は、テスト内に配列で書く（既存テストと同じ）

---

## 5. 手順7：値の中の記号（`symbols`）

### 5.1 ファイルと関数

```ts
// src/checks/symbols.ts
import type { Check, Finding, Table, CheckContext, Fix } from '../types';
import { matchSymbol, classifyColumns, type SymbolKind } from '../utils/values';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';

interface SymbolCell { row: number; col: number; raw: string; kind: SymbolKind; replacement: string }

function collectSymbolCells(table: Table, region: DataRegion, kinds: ColumnKind[]): SymbolCell[];
function createDashToZeroFix(cells: SymbolCell[]): Fix;                                   // 代替案
function createFlagColumnsFix(table: Table, region: DataRegion, cells: SymbolCell[]): Fix;  // 代替案

export const symbolsCheck: Check;   // id: 'symbols', title: '値の中の記号'
```

### 5.2 検出ルール

- 対象は `numeric` 列のデータ行のセルだけ。見出し行、`text` / `code` / `date` 列、データ領域の外（注記行の `※ 一部推計` など）は対象外。
- 各セルに `matchSymbol` を当て、種類ごとに集める。
- `△` / `▲` / `▼` は日本の統計でマイナス（減少）を表すので、欠損ではなく `negative` として扱う。数字の付かない `△` だけのセルは意味が決められないので `unknown`。
- `-` などのダッシュは、e-Stat の凡例では「該当数字なし」（実質 0）を意味することが多いが、資料によっては「不明」の意味でも使われる。そのため主修正は空欄、代替案で `0` を出す（PO 確認事項 Q1）。
- `unknown`（`<0.5`、`約100`、`(123)`、`100以上`）は意味が変わるので自動では直さず、場所だけ知らせる。
- **再検出のガード**：見出しが `_注記` で終わる列は対象外（`classifyColumns` で `text` になる）。

### 5.3 修正内容と選択肢

| 種類 | 主修正（warning） | 代替案（info + fix） |
|---|---|---|
| missing（x・…・秘匿など） | 空欄にする | 注記列に元の記号を残して空欄にする |
| dash（-・―・ーなど） | 空欄にする | `0` にする／注記列に残して空欄にする |
| negative（△・▲） | 記号を `-` に置き換える | なし |
| marker（※・*・p など） | マークを外して数値だけ残す | 注記列にマークを残して数値だけにする |
| unknown（<・約・括弧） | なし（info のみ） | なし |

注記列の代替案は、missing・dash・marker を **まとめて** 処理する1つの Fix にする。

- 記号のあった各 `numeric` 列について、表の右端に `{列名}_注記` の列を追加する（列名は `getColumnLabel`）。追加する列の見出しは `headerRow` に書き、ほかの見出し段や見出しより上の行には `''` を入れる。
- データ行には、記号のあったセルなら **元の値そのまま**（`x`、`…`、`※`、`p` など）を入れ、それ以外は `''`。記号の意味（秘匿・不詳など）を推測して書き換えないので、情報が失われない。
- 元のセルは、missing / dash は空欄に、marker は数値部分だけにする。negative は対象外（別の Finding で処理）。
- 対象の列が 6 列以上になる場合は代替案を出さない（横持ちの表で列が倍増するのを防ぐ。横持ち→縦持ちのあとなら1列で済む）。上限の数は PO 確認事項 Q4。

### 5.4 入出力例

例1：主修正を順に適用（フィクスチャ `with-symbols.csv`）

```csv
都道府県,事業所数,従業者数,前年比,備考
北海道,1234,x,△1.5,
青森県,-,…,2.0,-
岩手県,567※,8901,▲0.3,※速報
宮城県,890,***,-,
秋田県,<5,1200p,0.0,
```
→ missing 3 個（C2, C3, C5）、dash 2 個（B3, D5）、negative 2 個（D2, D4）、marker 2 個（B4, C6）、unknown 1 個（B6）。`備考` は文字の列なので対象外。主修正をすべて適用すると：
```csv
都道府県,事業所数,従業者数,前年比,備考
北海道,1234,,-1.5,
青森県,,,2.0,-
岩手県,567,8901,-0.3,※速報
宮城県,890,,,
秋田県,<5,1200,0.0,
```

例2：マイナス記号（全角は残し、手順8で半角にする）

```csv
品目,前年差
米,△1.5
麦,"▲１，２３４"
豆,2.0
```
→
```csv
品目,前年差
米,-1.5
麦,"-１，２３４"
豆,2.0
```

例3：代替案「記号を注記列に移す」

```csv
都道府県,従業者数
北海道,x
青森県,…
岩手県,8901p
```
→
```csv
都道府県,従業者数,従業者数_注記
北海道,,x
青森県,,…
岩手県,8901,p
```

例4：代替案「`-` を 0 にする」

```csv
都道府県,事業所数
青森県,-
岩手県,567
```
→
```csv
都道府県,事業所数
青森県,0
岩手県,567
```

### 5.5 Finding 一覧

| 種類 | severity | message | fix.description |
|---|---|---|---|
| missing | warning | `欠損・秘匿を表す記号が N 個見つかりました（x: 2, …: 1）。数値の列に文字が混ざっていると、表計算ソフトや Python で数値として扱えません。空欄にすると「値なし」として読み込めます。` | `記号を空欄にする（N セル）` |
| dash | warning | `「-」などのダッシュが N 個見つかりました。統計表では「該当する数字がない」を表すことが多い記号です。` | `「-」を空欄にする（N セル）` |
| negative | warning | `△・▲ の付いた数値が N 個見つかりました。日本の統計ではマイナス（減少）を表します。` | `△・▲ をマイナス記号に置き換える（N セル）` |
| marker | warning | `注記マーク（※・*・p など）の付いた数値が N 個見つかりました。マークを外すと数値として扱えます。` | `注記マークを外す（N セル）` |
| 代替：dash→0 | info | `別の方法：「-」を 0 にすることもできます。「該当なし＝0」とみなせる資料のときに使います。` | `「-」を 0 にする（N セル）` |
| 代替：注記列 | info | `別の方法：消す前に、元の記号を「従業者数_注記」などの列に残せます（N 列追加）。秘匿と不詳を区別したいときに使います。` | `記号を注記列に移す（N 列追加）` |
| unknown | info（fix なし） | `数値の列に、自動では判断できない記号が N 個あります（例: 「<5」「約100」）。意味が変わるおそれがあるので、必要なら元の資料で確認してください。` | — |
| 問題なし | info | `値の中の記号は見つかりませんでした。` | — |

- `ranges`：`cellsToRanges` でまとめたセル範囲。
- `metadata`：`{ kind: SymbolKind | 'dash-to-zero' | 'flag-columns', counts: Record<string, number>, cols: number[] }`（`counts` は元の記号ごとの個数）。

### 5.6 テストケース（`src/__tests__/symbols.test.ts`）

1. `x` `X` `ｘ` `秘匿` を missing として検出し、fix で空欄になる
2. `…` `・・・` `...` `‥` `***` を missing として検出する
3. `-` `－` `―` `—` `ー`（セル全体）を dash として検出し、fix で空欄になる
4. `△1.5` → `-1.5`、`▲１，２３４` → `-１，２３４`（全角は残る）
5. `1,234※` `※1,234` `123p` `456r` `789*` `1,234¹` `1,234（注１）` からマークだけを外す
6. `-1,234`（負の数）は dash にも negative にもならない
7. 文字の列（`備考`）の `-` と `※速報` は対象外
8. 見出し行と、データ領域の下の注記行（`※ 一部推計`）は対象外
9. コード列は対象外
10. 全セルが `x` の列でも、ほかに数値列があれば検出する
11. `<0.5` `約100` `(123)` `100以上` `△` は fix なしの info になり、表は変わらない
12. 代替案（注記列）：右端に `{列名}_注記` が追加され、元の記号が入り、元のセルは空欄／数値になる。適用後の再検出で missing / dash / marker は 0 件、注記列は検出されない
13. 代替案（注記列）は、対象の列が 6 列以上なら出ない
14. 代替案（dash → 0）：適用すると `0` になり、再検出で dash は 0 件
15. 代替案は info なので、チェックリストの件数に数えられない（`deriveCheckpointStatus` で確認）
16. 純粋性・冪等性

### 5.7 フィクスチャ

- `with-symbols.csv`（例1の内容）

---

## 6. 手順8：全角数字・桁区切り・単位（`format-number`）

### 6.1 ファイルと関数

```ts
// src/checks/formatNumber.ts
import type { Check, Finding, Table, CheckContext, Fix } from '../types';
import { parseNumericCell, classifyColumns, toHalfWidth, shiftDecimal, type ParsedNumber } from '../utils/values';
import { createCellEditFix, type CellEdit } from '../utils/cellEdit';

interface NumericCell { row: number; col: number; raw: string; parsed: ParsedNumber }

type ColumnUnitDecision =
  | { mode: 'strip'; unitLabel: string }        // 全セル同じ「倍率+単位」→ 文字を外して見出しへ
  | { mode: 'normalize'; unit: string }          // 単位は同じで倍率（万・億）だけ違う → 基本単位にそろえる
  | { mode: 'mixed'; units: string[] };          // 単位そのものが違う → 直さない

function collectNumericCells(table: Table, region: DataRegion, kinds: ColumnKind[]): NumericCell[];
function decideColumnUnit(cells: NumericCell[]): ColumnUnitDecision | null;
function headerWithUnit(header: string, unitLabel: string): string;   // 既に含んでいればそのまま

export const formatNumberCheck: Check;   // id: 'format-number', title: '全角数字・桁区切り・単位'
```

### 6.2 検出ルール

- 対象はデータ行のセル。全角・空白は `numeric` と `code` 列、桁区切りと単位は `numeric` 列だけ。`date` 列は手順9の担当なので対象外（`２０１８` を手順8と手順9が同時に出さないため）。
- 記号の付いたセル（`△`、`※` など）は `parseNumericCell` が読めないので対象外。手順7のあとで対象になる。
- **全角・前後の空白**：`hasFullWidth` または `hasPadding` のセル。修正後の値 = `toHalfWidth(raw.trim())`。コード列では `０１` → `01` になり、先頭の 0 は残る。文字の列の `第１位` は数値セルではないので対象外。
- **桁区切り**：`numeric` 列で `hasSeparator` のセル。修正は `raw.replace(/[,，](?=[0-9０-９]{3})/g, '')`。カンマの直後に数字が3つあるところだけを消すので、単位や全角はそのまま残る。
- **単位**：`numeric` 列ごとに、単位か倍率の付いたセルを集めて `decideColumnUnit` で決める。
  - 付いている「倍率+単位」が1種類だけ（`人`、`km²`、`%`、`万人` など）→ `strip`：セルから単位の文字を外し、見出しを `人口（人）` にする。見出しに既に `（人）` / `(人)` があれば見出しは変えない。見出しが空なら `列3（人）`。
  - 単位は同じで倍率だけが違う（`1.2万人` と `8,000人`）→ `normalize`：`shiftDecimal` で基本単位にそろえ（千=3、万=4、億=8、兆=12 桁）、見出しに `（人）` を付ける。単位のないセルは基本単位とみなす。浮動小数点は使わない。
  - 単位そのものが違う（`人` と `%`）→ `mixed`：直さず、info で知らせる（実数と構成比が1列に交互に入っている官庁統計によくある形）。
- 表の上にある「単位：千人」（`ctx.detectedUnit`）は手順8では使わない（3.7節・PO 確認事項 Q3）。

`shiftDecimal` の確認済みの例：`("1.2", 4)` → `12000`、`("1.23456", 4)` → `12345.6`、`("3", 8)` → `300000000`、`("0.5", 4)` → `5000`、`("-1.2", 4)` → `-12000`。

### 6.3 修正内容

3種類を別々の Finding・Fix にする（どの問題がどの修正で直るかを学べるように）。選択肢（代替案）はない。どの順で適用しても同じ結果になる。

### 6.4 入出力例

例1：全角・桁区切り・単位が混ざった表（フィクスチャ `with-number-formats.csv`）

```csv
コード,市区町村,人口,面積,人口密度
01,札幌市,"1,973,395人",1121.26km²,"1,760"
02,函館市,"２４８，９８９人",677.87km²,３６７
03,小樽市,"111,299人",243.83km²,456.5
```
→ 全角 2 セル（C3, E3）、桁区切り 4 セル（C2, C3, C4, E2）、単位 2 列（C「人」、D「km²」）。3つとも適用すると：
```csv
コード,市区町村,人口（人）,面積（km²）,人口密度
01,札幌市,1973395,1121.26,1760
02,函館市,248989,677.87,367
03,小樽市,111299,243.83,456.5
```
コード列の `01` はそのまま。

例2：倍率の違いをそろえる

```csv
地域,人口
A市,1.2万人
B町,"8,000人"
C村,950人
```
→
```csv
地域,人口（人）
A市,12000
B町,8000
C村,950
```
すべて `万人` なら、数値はそのままで見出しが `人口（万人）` になる。

例3：割合

```csv
年齢区分,割合
0〜14歳,11.6%
15〜64歳,59.4%
65歳以上,29.0%
```
→ `割合（%）` と `11.6` / `59.4` / `29.0`。0列目の `65歳以上` などは文字の列なので変わらない。

例4：単位が混ざった列（直さない）

```csv
項目,値
人口,"1,234人"
構成比,12.5%
```
→ 単位の Finding は出ず、info「列 B は単位がそろっていません（人, %）」が出る。桁区切りの Finding（B2）は出る。

### 6.5 Finding 一覧

| 種類 | severity | message | fix.description |
|---|---|---|---|
| 全角・空白 | warning | `N 個のセルに全角の数字や前後の空白があります（例: 「２４８，９８９人」）。半角にそろえると数値として読み込めます。` | `全角数字を半角にする（N セル）` |
| 桁区切り | warning | `N 個のセルに桁区切りのカンマがあります（例: 「1,973,395」）。CSV ではカンマが区切り文字と紛らわしく、数値ではなく文字として読まれる原因になります。` | `桁区切りを除去（N セル）` |
| 単位 | warning | `N 個の列で、セルの中に単位が書かれています（列 C「人」, 列 D「km²」）。単位を見出しに移すと、値を数値として扱えます。` | `単位を見出しに移す（列 C, D）` |
| 単位の混在 | info（fix なし） | `列 B は単位がそろっていません（人, %）。意味の違う値（実数と割合など）が1つの列に混ざっている可能性があります。` | — |
| 問題なし | info | `全角数字・桁区切り・単位の問題は見つかりませんでした。` | — |

- `ranges`：全角・桁区切りは対象セル、単位は対象セルと見出しセル。
- `metadata`：`{ kind: 'fullwidth' | 'separator', count: number, cols: number[] }`、単位は `{ kind: 'unit', columns: Array<{ col: number; mode: 'strip' | 'normalize'; unit: string; header: string }> }`、混在は `{ kind: 'mixed-unit', columns: Array<{ col: number; units: string[] }> }`。

### 6.6 テストケース（`src/__tests__/formatNumber.test.ts`）

1. `１，２３４` → 全角の fix で `1,234` → 桁区切りの fix で `1234`（1つずつでも、逆の順でも同じ結果）
2. コード列の `01` `02` は何も出ない。`０１` は全角の fix だけが出て `01` になる
3. `1,2`、`12,34` は触らない。`100,200` は `100200` になる
4. `1,234.5` → `1234.5`、`１．５` → `1.5`、`-1,234` → `-1234`、`−１２` → `-12`
5. `  123 ` → `123`（前後の空白）
6. 同じ単位の列：セルから `人` が外れ、見出しが `人口（人）` になる。見出しに既に `（人）` があれば見出しは変わらない
7. `%` の列：見出しが `割合（%）` になり、値は `11.6` のまま（0.116 にしない）
8. 倍率の混在：`1.2万人` `8,000人` `950人` → `12000` `8000` `950`、見出し `（人）`
9. すべて `万人` の列：数値は変えず、見出しが `（万人）`
10. 単位そのものが違う列：単位の fix は出ず、info が出る
11. `20～24歳`、`65歳以上`、`2020年`、`4月` は単位付き数値として扱わない
12. 文字の列の `第１位` は変わらない
13. `date` 列（見出し `年`）の `２０１８` は手順8では出ない
14. `km²` の `²` が `2` に変わらない（NFKC を使っていないこと）
15. 純粋性・冪等性

### 6.7 フィクスチャ

- `with-number-formats.csv`（例1の内容）

---

## 7. 手順9：和暦などの日付（`wareki`）

### 7.1 ファイルと関数

```ts
// src/utils/japaneseDate.ts
export type EraName = '明治' | '大正' | '昭和' | '平成' | '令和';
export type DateNotation = 'kanji' | 'abbr-kanji' | 'alpha' | 'western';

export interface ParsedDate {
  year: number;
  month?: number;
  day?: number;
  fiscal: boolean;           // 「年度」
  era: EraName | null;       // null なら西暦の表記
  notation: DateNotation;    // 令和 / 令 / R / 2023
  outOfRange: boolean;       // 平成32年 のように元号の最終年を超える
  crossesBoundary: boolean;  // 平成31年5月1日、令和元年4月1日 のように改元日をまたぐ
}

export type DateParseResult =
  | { ok: true; value: ParsedDate }
  | { ok: false; reason: 'invalid-date' | 'mismatch' }   // 日付らしいが変換できない
  | null;                                                // 日付ではない

export function parseJapaneseDate(raw: string): DateParseResult;
export function formatDate(d: ParsedDate): string;         // "2018" | "2018年度" | "2018-04" | "2018-04-01"

/** 見出し用：「_」区切りの各部分と末尾の（…）を考慮して変換する。変換できなければ null */
export function convertDateLabel(raw: string, allowAbbr: boolean): string | null;
```

```ts
// src/checks/wareki.ts
import type { Check, Finding, Table, CheckContext } from '../types';

function qualifiesForAbbr(table: Table, col: number, region: DataRegion, header: string): boolean;
function isDateColumn(table: Table, col: number, region: DataRegion, header: string, kind: ColumnKind): boolean;

export const warekiCheck: Check;   // id: 'wareki', title: '和暦などの日付'
```

### 7.2 検出ルール

#### 元号の表

| 元号 | 略記 | 元年 | 改元日 | 最終年 |
|---|---|---|---|---|
| 令和 | R、令 | 2019 | 2019-05-01 | — |
| 平成 | H、平 | 1989 | 1989-01-08 | 31 |
| 昭和 | S、昭 | 1926 | 1926-12-25 | 64 |
| 大正 | T | 1912 | 1912-07-30 | 15 |
| 明治 | M | 1868 | （1868-01-01 とみなす） | 45 |

西暦 = 元年の西暦 + 年 − 1（`元` は 1）。

#### 解析（`parseJapaneseDate`）

入力は `nfkcCompact(raw)`（`㋿`→`令和`、`㍻`→`平成`、`令和５年`→`令和5年`、`令和 5 年`→`令和5年`）。

```ts
const ERA_DATE_RE = /^(明治|大正|昭和|平成|令和|[昭平令]|[MTSHR])\.?(元|\d{1,2})(?:(年度?|[.\/-])(?:(\d{1,2})(?:月|[.\/-])?(?:(\d{1,2})日?)?)?)?$/i;
const WEST_RE     = /^(\d{4})(?:(年度?|[.\/-])(?:(\d{1,2})(?:月|[.\/-])?(?:(\d{1,2})日?)?)?)?$/;
const DUAL_RE     = /^(.+?)\((.+?)\)(年度?)?$/;   // 令和5年(2023年)、2023年(令和5年)、令和5(2023)年
const PAIR_SPLIT  = /[・/]/;                      // 平成31年・令和元年、平成31年/令和元年
```

1. `DUAL_RE` に一致し、両方が日付として読めれば：年が同じなら元号側を採用、違えば `{ ok: false, reason: 'mismatch' }`。
2. `PAIR_SPLIT` で2つに分かれ、両方に `年` があり、同じ年なら後ろを採用。
3. `ERA_DATE_RE`、次に `WEST_RE`（1868〜2100年だけ）。
4. 月は 1〜12、日は実在する日付か（`Date.UTC` で往復確認）。だめなら `{ ok: false, reason: 'invalid-date' }`。
5. `outOfRange`：元号の年が最終年を超える（計算どおり変換し、info で知らせる）。
6. `crossesBoundary`：月がある場合だけ判定。元年で改元日より前（`令和元年4月1日`、`平成元年1月7日`）、または次の元号の改元日以降（`平成31年5月1日`、`昭和64年1月8日`）。年だけの `平成31年` は正しい表記なので対象外。

確認済みの結果（試作）：

| 入力 | 出力 |
|---|---|
| `令和元年` `令和5年` `平成30年` `平成31年` `昭和64年` `大正15年` `明治45年` | `2019` `2023` `2018` `2019` `1989` `1926` `1912` |
| `R5` `H30` `S64` `R元` `h30` `Ｈ３０` | `2023` `2018` `1989` `2019` `2018` `2018` |
| `令和5年4月1日` `R5.4.1` `H30/4/1` `平30.4` `令和5年4月` | `2023-04-01` `2023-04-01` `2018-04-01` `2018-04` `2023-04` |
| `令和5年度` `㋿5年` `㍻30年` `令和 5 年` `令和５年` | `2023年度` `2023` `2018` `2023` `2023` |
| `平成31年5月1日` `令和元年4月1日` | `2019-05-01` `2019-04-01`（改元日をまたぐ印付き） |
| `平成32年` | `2020`（最終年超えの印付き） |
| `令和5年(2023年)` `2023年（令和5年）` `平成31年・令和元年` | `2023` `2023` `2019` |
| `令和5年(2022年)` / `令和5年2月30日` `令和5年13月` | 変換しない（mismatch / invalid-date） |
| `令和` `平成30年の調査` `R5-001` `H30A` `4月` `令和5年1～3月期` | 日付ではない（null） |
| `2023年` `2023年4月1日` `2023/4/1` `2023.04` `2023-04-01` `2023年度` `2023` | `2023` `2023-04-01` `2023-04-01` `2023-04` `2023-04-01` `2023年度` `2023` |

`M3` は解析上 `1870` になる。ねじの規格などを誤変換しないよう、略記はチェック側のガードで止める（次項）。

#### どのセルを変換するか（チェック側のガード）

- **データ行のセル（和暦）**
  - 漢字の元号（`notation: 'kanji'`）は、セル全体が日付なら、どの列でも変換する（`令和5年` という値は他の意味になりえない）。
  - 1文字の略記（`平30`）とアルファベット略記（`R5`、`H30.4.1`）は、`qualifiesForAbbr` が真の列だけ：見出しが `DATE_HEADER_RE` に一致する、または同じ列に漢字の元号か `年` / `月` / `/` を含む西暦のセルが1つ以上ある。ただし `M` と `T`（明治・大正）は見出しの条件でしか認めない（`M3`、`T5` は現代の表ではほぼ規格名のため）。
- **データ行のセル（西暦の書式統一）**：`isDateColumn` が真の列だけ。見出しが `DATE_HEADER_RE` に一致する、または空でないセルの 80% 以上が日付として読め、かつ1つ以上が `年` / `月` / `日` / `/` を含む（`.` や `-` は小数・負数と紛らわしいので根拠にしない）。`numeric` 列で見出しが日付でなければ対象外（`2023.5` kg を日付にしない）。変換後が元と同じセル（`2023`、`2023-04-01`）は数えない。
- **見出しのセル**：`headerRows` のすべての段を見る（年が上の段にある多段見出しに対応）。`convertDateLabel` で、`_` で区切った各部分を変換し、末尾の `（…）` は残す（`人口_平成30年` → `人口_2018`、`平成30年（人）` → `2018（人）`）。略記は、同じ見出し行で日付として読めるセルが2つ以上あり、その中に `M` / `T` の略記がないときだけ認める。同じ見出し行に和暦があるときは、西暦の `2020年` も `2020` にそろえる。
- 見出しの `（…）` は、先に `DUAL_RE` で「併記」として読めるかを試し、読めなければ単位などの付け足しとみなす。

### 7.3 修正内容と出力の形

| 元の表記 | 出力 |
|---|---|
| 年だけ | `2018` |
| 年度 | `2018年度`（PO 確認事項 Q2） |
| 年月 | `2018-04` |
| 年月日 | `2018-04-01` |

和暦の変換と西暦の書式統一は別の Finding・Fix にする。データのセルと見出しのセルも別にする（見出しの略記は誤変換の危険が比較的高いので、別々に確認できるように）。選択肢（代替案）はない。

### 7.4 入出力例

例1：年の列と日付の列（フィクスチャ `with-wareki.csv`）

```csv
年,調査日,件数
平成29年,H29.4.1,5
平成30年,平成30年4月1日,7
令和元年,R1.5.1,8
R2,2020/5/1,9
2021年,2021年5月1日,10
```
→ 和暦 7 セル（A2〜A5, B2〜B4）、書式統一 3 セル（A6, B5, B6）。両方適用すると：
```csv
年,調査日,件数
2017,2017-04-01,5
2018,2018-04-01,7
2019,2019-05-01,8
2020,2020-05-01,9
2021,2021-05-01,10
```

例2：横持ちの表の見出し（フィクスチャ `wareki-wide.csv`）

```csv
都道府県,平成30年度,令和元年度,令和2年度,合計
北海道,100,110,120,330
青森県,50,55,60,165
```
→ 見出しの和暦 3 セル：
```csv
都道府県,2018年度,2019年度,2020年度,合計
北海道,100,110,120,330
青森県,50,55,60,165
```
（`合計` 列は手順6で合計列として検出される。）

例3：改元日をまたぐ表記

```csv
調査日,件数
平成31年4月30日,7
平成31年5月1日,8
```
→ `2019-04-30` / `2019-05-01` に変換し、info「元号の切り替えをまたぐ表記があります（例: 「平成31年5月1日」）」も出す。

例4：変換しない表（フィクスチャ `unit4-guards.csv` の一部）

```csv
商品コード,商品名,サイズ,価格,備考
001,ねじ,M3,"1,980",-
002,ボルト,M4,500,※在庫限り
010,ナット,M5,300,約10日
```
→ 手順9は何も出さない（`サイズ` は日付の見出しではなく、同じ列に日付もない）。手順7は `備考` が文字の列なので何も出さない。手順8は `価格` の桁区切り 1 セルだけ。コード列 `001` はそのまま。

### 7.5 Finding 一覧

| 種類 | severity | message | fix.description |
|---|---|---|---|
| 和暦（値） | warning | `N 個のセルに和暦の日付があります（例: 「平成30年」→「2018」）。西暦にそろえると、並べ替えやグラフの時間軸が正しく扱えます。` | `和暦を西暦に変換（N セル）` |
| 和暦（見出し） | warning | `見出しに和暦が N 個あります（例: 「令和元年度」→「2019年度」）。横持ち→縦持ち（手順10）のあと、年の列として使えるようになります。` | `見出しの和暦を西暦に変換（N 列）` |
| 書式の統一 | warning | `日付の書き方がそろっていません（例: 「2020/5/1」→「2020-05-01」）。` | `日付を「2020-05-01」の形にそろえる（N セル）` |
| 改元日・最終年 | info（fix なし） | `元号の切り替えをまたぐ表記があります（例: 「平成31年5月1日」）。西暦では正しく変換されますが、元の資料を確認しておくと安心です。` | — |
| 変換できない | info（fix なし） | `変換できない日付の表記が N 個あります（例: 「令和5年1～3月期」「令和5年2月30日」）。` | — |
| 問題なし | info | `和暦・日付の表記ゆれは見つかりませんでした。` | — |

- 「変換できない」の対象：`{ ok: false }` になったセルと、日付の列・見出しの中で `/(明治|大正|昭和|平成|令和)(元|\d)/` を含むのに全体としては読めないセル。
- `metadata`：`{ kind: 'era-cells' | 'era-headers' | 'date-format', mapping: Array<{ from: string; to: string }> }`（重複を除き最大 50 組）、info は `{ kind: 'boundary' | 'unparsed', examples: string[] }`。

### 7.6 テストケース

`src/__tests__/japaneseDate.test.ts`（解析だけ）

1. 7.2節の確認済みの表の全行（漢字・略記・年月日・年度・合字・全角・併記・改元日・最終年超え・不正な日付・日付でないもの・西暦）
2. `formatDate` が `2018` / `2018年度` / `2018-04` / `2018-04-01` を返す
3. `convertDateLabel`：`人口_平成30年` → `人口_2018`、`平成30年（人）` → `2018（人）`、`令和5年(2023年)` → `2023`

`src/__tests__/wareki.test.ts`（チェック）

1. 見出し `年` の列で、漢字の和暦と `R2` を変換する
2. 見出し `サイズ` の列の `M3` `M4` は変換しない
3. 見出しが日付でなくても、同じ列に漢字の和暦があれば `H30` を変換する
4. `M` / `T` の略記は、見出しが日付のときだけ変換する
5. 文字の列にある `令和5年`（セル全体）は変換する。`平成30年の調査` は変換しない
6. 横持ちの見出し `平成30年度` → `2018年度`、多段見出しの上の段の和暦も変換する
7. 西暦の書式統一は日付の列だけ。見出しが日付でない `numeric` 列の `2023.5` は変えない
8. 改元日をまたぐ表記・最終年超えは変換したうえで info が出る
9. 変換できない表記は info が出て、表は変わらない
10. 純粋性・冪等性

### 7.7 フィクスチャ

- `with-wareki.csv`（例1）、`wareki-wide.csv`（例2）、`unit4-guards.csv`（例4）

---

## 8. 実行順序と依存関係

### 8.1 実行の順番

`runChecks` は registry 順（1→2→…→9）に全チェックを実行する。修正を1つ適用するたびに全チェックがやり直される。手順6〜9の検出は互いの結果を読まない（`ctx` にも書き込まない）。

```mermaid
flowchart LR
  S1[1 文字コード] --> S3[3 空行・空列]
  S3 --> S4[4 タイトル・単位・注記]
  S4 --> S5[5 多段ヘッダー]
  S5 --> S6[6 合計・小計]
  S6 --> S7[7 記号]
  S7 --> S8[8 全角・桁区切り・単位]
  S8 --> S9[9 和暦]
  S9 --> S10[10 横持ち→縦持ち（Unit 5）]
```

### 8.2 依存関係

| 手順 | 前に済ませたい手順 | 理由 | 済んでいないときの動き |
|---|---|---|---|
| 6 | 4（単位行の削除を含む）、5 | 見出し行の位置と列名を使う。結合セルの値が展開されていると小計のラベルを拾いやすい | `getDataRegion` がタイトル・単位・注記行を飛ばすので誤検出はしない。合計列の判定は見出しの最下段で行う |
| 7 | 4 | 注記行の `※` を拾わないため | データ領域の外は見ないので問題なし |
| 8 | 7 | `△10` や `1,310※` は記号を外すまで数値として読めない | そのセルだけ手順8の対象外になり、手順7のあとで再検出される |
| 9 | 5 | 平らにした見出し（`人口_平成30年`）や多段見出しの年を変換するため | 多段のままでも全段を見るので変換できる |
| 6の検算 | なし | 全角・カンマは自前で読み、記号のある列は比べない | — |

- 手順6〜9の修正はどの順で適用しても同じ表になる（2.7節）。例：手順8の「単位を見出しへ」（`平成30年` → `平成30年（人）`）と手順9の見出し変換（→ `2018（人）`）は、逆の順でも `2018（人）` になる。手順7の注記列（`平成30年_注記`）も手順9で `2018_注記` になる。
- 手順4の前提修正（3.7節）を入れない場合、ユーザーが単位行を残したまま手順5を適用すると見出しが壊れる（1.2節）。

### 8.3 統合での期待結果

1.2節の CSV（フィクスチャ `estat-unit4.csv`）に、手順3・4（タイトル・注記・単位行の削除）と手順6〜9の主修正をすべて適用した結果：

```csv
都道府県,2018,2019,2020
北海道,500,,
青森県,734,,1310
```

---

## 9. Unit 5・Unit 6 への引き継ぎ

Unit 4 のあとの表は次の状態になる。Unit 5・6 はこれを前提にしてよい。

- 見出しは1行（手順5）。集計行・合計列はない（手順6）。
- `numeric` 列の値は、半角・桁区切りなし・単位なしの10進数の文字列か空欄（手順7・8）。単位は列名の末尾の `（人）` にある。
- 日付は `2018` / `2018年度` / `2018-04` / `2018-04-01`。横持ちの見出しの年も同じ形（手順9）。
- 注記列は `{列名}_注記` の名前で右端にある（手順7の代替案を選んだ場合）。

Unit 5（横持ち→縦持ち）向け：

- 残す列（id 列）と縦にする列の初期値には `classifyColumns` を使える（`text` / `code` / `date` を id 列、`numeric` を縦にする列）。
- 縦にする列の見出しに共通の `（単位）` があれば、それを外して値の列名に移すとよい（`2018（人）` → 年 `2018`、値の列名 `人口（人）`）。
- `{列名}_注記` の列は、対応する値の列と組にして縦にする。

Unit 6（Python コード出力）向け：

- 各 Finding の `metadata` に、修正内容を pandas の処理に置き換えられるだけの情報を入れた（4〜7章の各「Finding 一覧」）。
- ただし `HistoryEntry.appliedFix` には今は `checkId` と `fixDescription` しか残らない。Unit 6 で `appliedFix` に `metadata` を写す（`applyFix` の1か所）必要がある。Unit 4 ではここを変えない。

---

## 10. 実装サブユニット

モデルの選び方（指定された基準）：

- 設計の比重が大きい／新しい単位の土台／データモデルに関わる → `claude-opus-5-5`（effort: `xhigh`）
- 通常の機能・UI → `grok-4.7`（reasoning_effort: `high`、fast: `true`）
- 文言・CSS・1か所の修正 → `grok-4.7`（reasoning_effort: `medium`、fast: `true`）

| ID | 内容 | 難易度 | 推奨モデル | 依存 |
|---|---|---|---|---|
| U4-01 | 共通基盤（`dataRegion` / `values` / `cellEdit` / `cellRef` の追加関数、既存関数の export） | 高 | claude-opus-5-5（xhigh） | — |
| U4-02 | 前提修正：手順4で単位行を削除できるようにする | 中 | grok-4.7（high、fast） | Q3 の回答 |
| U4-03 | 手順6：集計行・小計行・再掲行・合計列の検出と削除、registry への接続 | 中 | grok-4.7（high、fast） | U4-01 |
| U4-04 | 手順6：検算（メッセージの強化） | 中 | grok-4.7（high、fast） | U4-03 |
| U4-05 | 手順7：記号4種の主修正と「判断できない記号」の info、registry への接続 | 中 | grok-4.7（high、fast） | U4-01 |
| U4-06 | 手順7：代替案（`-` → 0、注記列） | 中 | grok-4.7（high、fast） | U4-05、Q1・Q4 の回答 |
| U4-07 | 手順8：全角・空白と桁区切り、registry への接続 | 中 | grok-4.7（high、fast） | U4-01 |
| U4-08 | 手順8：セルの中の単位（倍率・%・混在） | 中〜高 | grok-4.7（high、fast） | U4-07 |
| U4-09 | 和暦の解析 `japaneseDate.ts` | 高 | claude-opus-5-5（xhigh） | — |
| U4-10 | 手順9：チェック本体（値・見出し・書式統一・ガード・info）、registry への接続 | 中 | grok-4.7（high、fast） | U4-01、U4-09、Q2 の回答 |
| U4-11 | `FixPreview`：修正後のグリッドでも変更したセルを強調 | 低 | grok-4.7（medium、fast） | — |
| U4-12 | 統合テスト（e-Stat 風フィクスチャ、順序を変えても同じ結果、性能） | 中 | grok-4.7（high、fast） | U4-02〜U4-10 |
| U4-13 | 文言とドキュメント（registry の説明文、`docs/PLAN.md` の実装状況） | 低 | grok-4.7（medium、fast） | U4-12 |

U4-01 と U4-09 は並行して進められる。U4-03 / U4-05 / U4-07 も U4-01 のあと並行できる。

### 全サブユニット共通の完了条件・検証手順

- `npm test`、`npm run lint`、`npm run build` がすべて成功する。既存の 114 件が通る（U4-02 で直す1件と、U4-03 で直す registry 系の期待値を除き、既存テストの期待値は変えない）。
- `src/types/index.ts` を変更していない。
- 画面での確認：`npm run dev` を起動し `http://localhost:5173/?auth_debug` を開き、該当フィクスチャをドロップする。チェックリストの該当ステップが「未実装」ではなく「N件」になり、結果パネルの「修正をプレビュー」→「この修正を適用」で表が変わり、「元に戻す」で元に戻ること。
- 1つの PR = 1つのサブユニット。

### U4-01 共通基盤

- 内容：3.1〜3.5節のとおり。`titleNotes.ts` と `multiHeader.ts` は `export` を付けるだけ。
- 完了条件：`getDataRegion` / `parseNumericCell` / `matchSymbol` / `classifyColumns` / `toHalfWidth` / `shiftDecimal` / `applyCellEdits` / `formatRowList` / `formatColList` / `cellsToRanges` のテスト（`values.test.ts`、`dataRegion.test.ts`、`cellEdit.test.ts`、`cellRef.test.ts` に追加）が通る。3.3節の表の全行がテストになっている。画面の動きは変わらない。
- 検証：`npm test`。`dataRegion.test.ts` で、`government-style.xlsx` の「人口」シートと 1.2節の CSV について、見出し行とデータ行の範囲が 3.2節のとおりになることを確かめる。

### U4-02 前提修正（手順4の単位行）

- 内容：3.7節のとおり。
- 完了条件：単位行が warning + fix になり、適用すると単位行が消える。空でないセルが3つ以上ある行（見出し行など）は削除の対象にならない。1.2節の CSV で、手順4のあとに手順5の誤検出（`単位：事業所_都道府県`）が起きない。`government-style.xlsx` の「人口」シートで、単位行の削除後に2段見出しが検出される。
- 検証：`titleNotes.test.ts` に上の3つを追加。画面で 1.2節の CSV を読み込み、手順4の修正をすべて適用したあと、手順5が「検出されませんでした」になること。

### U4-03 手順6 本体

- 内容：4.1〜4.3、4.5節（検算を除く）。`registry.ts` の `totals` に接続し、`registry.test.ts` と `checkpointStatus.test.ts` の未実装の例を直す。
- 完了条件：4.6節の 1〜11、13〜17 が通る。
- 検証：画面で `with-totals.csv` を読み込み、手順6に4件（集計行・小計行・再掲行・合計列）が出て、それぞれ適用・元に戻すができる。`totals-false-positives.csv` では「見つかりませんでした」。

### U4-04 手順6 検算

- 内容：4.2節「検算」。メッセージと `metadata.verifiedRows` / `verifiedCols` にだけ反映する。
- 完了条件：4.6節の 12 が通る。検算の有無で検出件数が変わらない。
- 検証：`with-totals.csv` で「全国」「東北計」「総数」に「一致しました」が付く。

### U4-05 手順7 主修正

- 内容：5.1〜5.3節の主修正、5.5節の warning と unknown の info。`registry.ts` の `symbols` に接続。
- 完了条件：5.6節の 1〜11、16 が通る。
- 検証：画面で `with-symbols.csv` を読み込み、手順7に「4件」、info に「<5」が出る。主修正をすべて適用すると 5.4節例1の表になる。

### U4-06 手順7 代替案

- 内容：5.3節の代替案2つ。
- 完了条件：5.6節の 12〜15 が通る。代替案を適用したあと、手順7の warning が 0 件になり、ステータスが「修正済み」になる。
- 検証：画面で 5.4節例3の表を読み込み、「別の方法：」の info から「記号を注記列に移す」を適用すると右端に `従業者数_注記` ができる。

### U4-07 手順8 全角・桁区切り

- 内容：6.2節の全角・空白と桁区切り。`registry.ts` の `format-number` に接続。
- 完了条件：6.6節の 1〜5、12〜15 が通る。
- 検証：画面で `with-number-formats.csv` を読み込み、全角と桁区切りの2件が出て、適用するとコード列の `01` が残ったまま数値が半角・カンマなしになる。

### U4-08 手順8 単位

- 内容：6.2節の単位（`strip` / `normalize` / `mixed`）。
- 完了条件：6.6節の 6〜11 が通る。`shiftDecimal` が浮動小数点を使っていない（`1.23456万` → `12345.6` で確認）。
- 検証：`with-number-formats.csv` の3つの修正をすべて適用すると 6.4節例1の最終形になる。順番を変えても同じになる。

### U4-09 和暦の解析

- 内容：7.1節の `japaneseDate.ts` と 7.2節の解析規則。
- 完了条件：7.6節の `japaneseDate.test.ts` がすべて通る（7.2節の確認済みの表の全行を含む）。
- 検証：`npm test`。チェックへの接続はまだしない。

### U4-10 手順9 本体

- 内容：7.1〜7.5節のチェック側。`registry.ts` の `wareki` に接続。
- 完了条件：7.6節の `wareki.test.ts` がすべて通る。
- 検証：画面で `with-wareki.csv` と `wareki-wide.csv` を読み込み、7.4節の結果になる。`unit4-guards.csv` で手順9が何も出さない。

### U4-11 修正プレビューで変更セルを強調

- 内容：`FixPreview.tsx` で、行が減らず `fix.deletedCols` もない修正のとき、修正後の `DataGrid` にも `highlightRanges={finding.ranges}` を渡す（セルの値を書き換える修正と、右端に列を足す修正では位置が変わらないため）。
- 着手前に必ず **emil-design-eng スキルを読み、その指針に従う**（利用者のルール）。このスキルは設計を書いた環境には無かったので、実装する環境で読み込むこと。強調は既存の `.highlighted` クラスをそのまま使い、新しいアニメーションは足さない。
- 既知の制約：`DataGrid` のセル id（`cell-行-列`）は画面のグリッドとプレビューの2つのグリッドで重複するため、プレビュー内の自動スクロールは効かない。U4-11 では直さない。
- 完了条件：手順7の修正プレビューで、修正後の側でも変わったセルが強調される。行削除の修正では修正後の側は強調されない。
- 検証：画面で `with-symbols.csv` の「記号を空欄にする」をプレビューし、両側の強調を目で確認する。

### U4-12 統合テスト

- 内容：`src/__tests__/unit4Pipeline.test.ts`。
  - `estat-unit4.csv` を `readFileSync` + `parseCSVWithMeta` で読み、registry 順に「その手順の warning の fix を1つ適用 → 全チェックを再実行」を warning がなくなるまで繰り返し（上限 50 回）、8.3節の表になることを確かめる。
  - 手順6〜9の順番を並べ替えた4通り（6789 / 9876 / 8796 / 7968）で同じ表になることを確かめる。
  - 2万行 × 10列の合成表で、手順6〜9の `detect` の合計が 3 秒未満（CI でぶれないよう緩い閾値）。
- 完了条件：上の3つが通る。
- 検証：`npm test`。

### U4-13 文言とドキュメント

- 内容：`registry.ts` の説明文を次のように直す。`docs/PLAN.md` の「チェックポイント順序」の表で手順6〜9を ✅ にし、Unit 4 の節にこの設計書へのリンクを足す。
  - `totals`：`合計・小計の行や合計列を検出します。分析時に二重カウントを防ぐため除去できます。`
  - `symbols`：`※、-、…、x、秘匿、△などの記号を検出し、欠損値やマイナスの数値として処理できます。`
  - `format-number` / `wareki`：今のままでよい。
- 完了条件：`registry.test.ts` の「日本語の名前と説明」のテストが通る。
- 検証：画面のチェックリストで説明文を確認する。

---

## 11. PO に確認したいこと

既定値は推奨案で設計してあり、回答によって変わるのは該当サブユニットの一部だけです。

**Q1. 「-」（ダッシュ）を空欄にするか 0 にするか**
e-Stat の凡例では「-」は「該当数字なし」（実質 0）ですが、自治体や業界団体の資料では「不明」の意味でも使われます。
推奨：主修正は「空欄」、代替案（info）で「0 にする」を出す。→ 影響：U4-05、U4-06

**Q2. 年度の出力の形**
推奨：`2018年度`（年度であることが値に残り、文字列として並べても正しい順になる）。
別案：`2018` にして、列の見出しに `（年度）` を付ける（数値として扱いやすいが、横持ちの見出しでは付ける場所がない）。→ 影響：U4-09、U4-10

**Q3. 「単位：千人」のような単位行の扱い**
今はどの修正でも消えずに書き出しに残り、手順5の見出し判定も狂わせます（1.2節）。
- A（推奨）：削除だけ行う。単位は修正の説明文と記録に残り、Unit 6 で Python コードのコメントにできる。
- B：削除して、すべての数値列の見出しに `（千人）` を付ける。表の中に単位の違う列（例：世帯数）があると誤った見出しになる。
- C：今のまま残す。
→ 影響：U4-02

**Q4. 「記号を注記列に残す」代替案を最初の版に入れるか**
秘匿（x）と不詳（…）を区別したい利用者向けです。横持ちの表では列が増えるため、対象が 5 列までのときだけ出す設計にしました。
推奨：入れる（上限 5 列）。入れない場合は U4-06 の注記列部分を省く。→ 影響：U4-06

---

## 12. スコープ外・既知の制約

- **Excel の日付とエラー値**：`excel.ts` は `cell.v` を使うため、日付のセルはシリアル値（例 `45017`）、エラーのセル（`#N/A`）はエラーコードの数値になる。和暦の表示形式で書かれた Excel の日付も同じ。手順9では扱わない。`cell.w`（表示文字列）を使うかどうかは手順2側の別課題とする。
- **明治初期の旧暦**：明治5年12月2日以前の月日は旧暦だが、新暦として計算する。
- **「（再掲）」見出しの下の行**：見出し行だけでは、どこまでが再掲かを自動で判断しない（info で知らせるだけ）。
- **ラベルのない合計行**：ラベルに合計を表す語がなく、数値だけが合計になっている行は検出しない（数値だけで判断すると誤検出が多いため）。
- **手順5の残る弱点**：タイトル行が残っていると多段ヘッダーを検出できない（0行目を常に見出しとみなすため）。手順6〜9は `getDataRegion` で回避するが、手順5そのものは Unit 4 では直さない。
- **大きな表の描画**：`DataGrid` は全セルについて全 range を照合する。Unit 4 では range をまとめて数を減らすが、`DataGrid` 自体の高速化はしない。
- **「修正済み」の表示**：`buildFixHistory` は読み込み時の結果しか見ないため、ほかの修正のあとで初めて出てきた問題（例：手順7のあとに出る手順8の桁区切り）は、直しても「修正済み」ではなく「○」と表示される。既存の仕様のままとする。
