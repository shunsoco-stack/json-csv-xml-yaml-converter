# ポートフォリオ掲載情報

## 基本情報

| 項目 | 内容 |
| --- | --- |
| 作品名 | JSON・CSV・XML・YAML変換ツール |
| カテゴリ | 業務効率化ツール |
| サブカテゴリ | データ変換・開発支援 |
| 概要 | 構造化データのValidation、Mapping、型変換、Filter、形式変換をGUIの処理フローとして組み、テンプレート再利用できるローカルファーストWebツール |
| 想定ユーザー | システム移行、データ連携、API確認、運用保守、開発を担当する人 |
| 対応Format | JSON、CSV、XML、YAML |
| アイコン | `public/icons/data-shift.svg` |
| 公開URL | なし。local buildのみで、hostingは未設定 |
| GitHub URL | 本作品専用remoteは未設定 |
| スクリーンショット | 2026-08-13にlocal appを撮影した7枚を `docs/screenshots/` へ収録・目視確認済み |

## 解決する課題

システム間のデータ移行やAPI連携では、Formatだけでなく、キー名、nestの位置、型、必須項目、抽出条件が異なります。担当者は変換用スクリプト、表計算ソフト、オンライン整形サイトを行き来し、同じ作業を案件やリリースのたびに繰り返しがちです。機密性のあるAPI responseや顧客データを外部サービスへ貼り付けにくいという問題もあります。

本作は、入力からValidation、Mapping、Type Conversion、Transformation、別FormatへのExportまでをブラウザ内の一つの作業面へ統合します。処理設定をTemplateとして端末内に保存できるため、次回は新しいデータを入れ、保存済みTemplateを適用して結果を確認するだけで同じ変換を再現できます。

## 中心価値

```text
異なるシステムのData
  ↓
Syntax / Schema Validation
  ↓
Nested Mapping
  ↓
Filter / Field Selection / Default Value
  ↓
Type Conversion
  ↓
JSON / CSV / XML / YAML Transformation
  ↓
Diffを確認してExport
  ↓
Templateとして再利用
```

「JSONをきれいに表示するサイト」ではなく、システム連携の変換ルール自体をGUIで設計・保存する業務ツールとして説明します。

## 主な利用体験

1. Paste、File Upload、Sample Dataから入力する。
2. 自動判定されたFormatを確認し、必要なら手動で修正する。
3. Code Editor、Data Tree、Tableで内容を確認する。
4. Syntax ErrorのLine、Column、Reason、またはSchema Errorのpathを修正する。
5. Transformation BuilderでFlatten、Mapping、Filter、Type Conversion等を順に組む。
6. Before / AfterとAdded / Removed / ChangedのDiffを確認する。
7. 出力Format、Indent、Minify、CSV／XML固有設定を選ぶ。
8. 結果をCopyまたはDownloadする。
9. 処理フローをTemplateとして保存し、別データへ再実行する。

## Mappingの見せ場

```text
customer_name
  → customerName

customer.address.city
  → address.cityName
```

GUIでsource pathとtarget pathを結び、階層をまたぐキー変更を定義できる点が作品の主要な見せ場です。Mapping Failureはpathと理由を示し、Default Valueやrequiredの判断へつなげます。

## Format変換ルール

- JSON / YAMLは共通のstructured data modelを介して変換する。
- CSVはHeaderとDelimiterを扱い、nested valueはFlatten、Dot notation、JSON Stringを選択する。
- XMLはrootを保持し、属性を `@name`、textを `#text`、同名の繰り返し要素を配列として変換する。DOCTYPEは安全のため拒否する。
- Pretty PrintはIndent 2 / 4、JSON・XML等はMinifyを選べるようにする。
- Format間で保持できない情報は制約として明記し、Diffで確認する。

## Local-firstと安全性

- 入力、Parse、Validation、変換、Diff、Serialize、Downloadをブラウザ内で処理する。
- 入力データと変換結果をアプリ固有のserverや外部AI APIへ送信しない。
- 入力データ本体はlocalStorageへ保存しない。
- localStorageへ保存するのはユーザーが保存したTemplate設定に限定する。
- 公開ページの配信通信と、入力データの処理経路を区別して説明する。

## UI / Design

Apple Designの考え方をWeb業務ツールへ翻訳し、情報量の多い画面でも階層、余白、状態変化、操作の連続性が理解できるUIを目指します。

- Code Editor + Data Tree + Table + Transformation Builderの統合
- 操作に追従するTransformation Flow
- 選択中のStepと設定panelの明確な対応
- destructive action、validation error、successの区別
- keyboard操作、focus表示、contrast、touch targetへの配慮
- `{}` とTransformation Arrowを組み合わせた専用SVGアイコン

## Architecture / Engineering Decisions

- Format別Parser / Serializerと変換エンジンをUIから分離する。
- nested path操作、diagnostic、pipeline step、templateをserializableな型として定義する。
- Pipelineの順序を結果へ反映し、各Stepの有効／無効を保存可能にする。
- 200,000 bytes超または推定5,000 records超でmodule Web Workerへ切り替え、Tableはvisible rowsとoverscanだけを描画する。
- 構文、encoding、mapping、filter、type conversion、schema、template errorを同じdiagnostic modelで区別する。
- Static export可能なNext.js App Router構成とし、サーバー機能へ依存しない。

## 技術構成

- Next.js 16.3 / React 19.2 / TypeScript 5.9
- YAML / fast-xml-parser / Ajv / encoding-japanese
- Web Worker / File API / Clipboard API / localStorage
- Lucide React / 専用SVG
- Vitest / Testing Library / jsdom / ESLint

## Demoシナリオ

### EC API JSON → CSV

架空のEC API responseを読み込み、customerとaddressのKey Mapping、itemのFlatten、active recordのFilter、amountとdateのType Conversion、CSV Exportまでを一つのFlowで示します。

### Legacy XML → JSON

古い連携XMLを読み込み、root、属性、繰り返し要素の変換規則を確認しながらJSONへ変換します。

## 品質確認方針

2026-08-13に、`npm.cmd run verify` と `npm.cmd run build:sites` の成功を確認しています。Vitestは3 files・31件で、Engine、Workbench Adapter、組込みEC Demoを使ったWorkbench表示を対象にし、Format I/O、変換、diagnostic、Diff、Schema、Template、GUI設定からpipelineへの変換を確認しています。Next.js buildは `/`、`/_not-found`、`/icon.svg`、`/manifest.webmanifest` をstatic生成しました。

in-app browserでは、Input / Output、Tree、Nested Mapping、Transformation Flow、invalid JSONのLine 3 / Column 46 / Reason、Diff、Legacy XML 2 → 2、生成SchemaのAjv Valid、Template `API A → System B` の保存・再適用、Copy / Downloadのsuccess toastを確認しました。895,385 bytes・5,200 recordsのJSONはWorker経由で2,600 recordsへ変換し、virtualized Tableを表示しました。390 × 844でも主要画面を操作可能で、console warning / errorは0件でした。公開URLはなく、Network panel、keyboard / screen reader、複数browserは追加確認事項です。

- Network panelで入力データの外部送信がないことを独立確認する
- keyboard focus sequenceとscreen readerを確認する
- in-app browser以外の複数browserで再確認する
- 公開する場合は本番URLでWorker、Copy、Download、Templateを再確認する

確認済み範囲と追加manual確認は `docs/QA_REPORT.md` に記録します。

## 推奨スクリーンショット

次の7枚はすべて実在し、2026-08-13に寸法と内容を目視確認しています。

1. `01-input-output-desktop.jpg` — InputとOutput、Format選択、Local-first表示
2. `02-tree-view-desktop.jpg` — Collapse / Expand可能なData Tree
3. `03-mapping-desktop.jpg` — nested pathを含むMapping設定
4. `04-transformation-flow-desktop.jpg` — ValidationからExportまでのFlow
5. `05-validation-error-desktop.jpg` — Line / Column / Reasonを含むSyntax Error
6. `06-diff-desktop.jpg` — Added / Removed / Changedの構造Diff
7. `07-template-desktop.jpg` — Template保存と再利用

実寸、file size、確認内容、altは `docs/screenshots/README.md` に記載しています。公開URLの画面ではなくlocal appの証跡です。

## 紹介文案

### 短い紹介文

JSON・CSV・XML・YAMLのValidation、Nested Mapping、型変換、Filter、Diff、ExportをGUIでFlow化し、Template再利用できるローカルファースト業務ツールです。

### 詳細紹介文

システム移行やAPI連携で繰り返す構造化データ変換を、ブラウザ内で組み立てる業務効率化ツールです。JSON・CSV・XML・YAMLのFormat検出とSyntax Validation、Tree / Table表示、Nested Mapping、Flatten、Filter、Type Conversion、Field Selection、Default Value、Schema Validation、Diff、Copy / Downloadを一つのワークベンチへ統合。処理FlowはTemplateとして端末内に保存し、次回のデータへ再実行できます。入力データをアプリ固有のサーバーへ送信しないLocal-first設計です。

## 掲載時の注意

- 公開URL、GitHub URL、テスト件数、性能値は実在・実測を確認した場合だけ追記する。
- スクリーンショットは実装済み画面を実ブラウザで撮影し、架空データだけを使う。
- 「Local-first」は入力データ処理について説明し、Webページ配信まで完全offlineとは断定しない。
- Format変換は全情報を損失なく往復できるとは表現せず、XML / YAML / CSVの制約を併記する。
- JSONPath / XPath、Schema、Encoding、大容量処理は、最終実装で確認できた対応範囲だけを掲載する。

## 実装上の制約

- JSONPathはproperty、array index、wildcard、quoted propertyに限定し、predicateとrecursive descentは扱わない。
- XPathは `/`、`//`、`[n]`、`@attribute`、`text()`、`*` のsubsetである。
- XMLのmixed content順序、comment、namespace、CDATA表現、YAML comment・anchor・tagは往復保持しない。
- CSV cellはParse時点ではstringであり、必要なfieldへType Conversionを設定する。
- Schema候補生成はSampleから保守的に型を統合する通常ロジックで、業務要件を推測しない。
- Table virtualizationとWorker切替はUI停止を抑える設計であり、全端末・全データ形状の性能を保証しない。
- Editorは行番号付きの軽量textareaであり、IDE相当のsyntax highlighting、補完、multi-cursorは備えない。
- Templateは現在のbrowserのlocalStorageへ保存し、cloud同期・共有・account管理は行わない。
- 公開hostingと本作品専用Git remoteは未設定である。確認できないURLを掲載しない。
