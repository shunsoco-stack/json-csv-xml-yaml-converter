# 既存ポートフォリオへ追加するためのCodex用プロンプト

以下を、完成した「JSON・CSV・XML・YAML変換ツール」を既存ポートフォリオへ追加する作業のプロンプトとして使用してください。

2026-08-13時点のlocal baselineでは、`npm.cmd run verify`、31 tests、static build、Sites成果物の生成が成功し、指定7枚のPNGを目視確認しています。in-app browserではLegacy XML、Ajv Schema Validation、Template保存・再適用、Copy / Download、390 × 844 mobile、5,200 recordsのWorker変換、console warning / error 0件も確認しています。公開URLと本作品専用Git remoteはありません。将来の掲載作業では、このbaselineをそのまま信用せず、その時点の実装と成果物を再確認してください。

---

「JSON・CSV・XML・YAML変換ツール」を既存ポートフォリオへ追加してください。説明文を先に転記するのではなく、最初にこのリポジトリと実際に動作する完成ツールを確認し、確認できた事実だけを掲載してください。

## 1. 最初に確認するもの

1. `README.md`
2. `docs/PORTFOLIO.md`
3. `docs/screenshots/README.md`
4. `package.json` とlockfile
5. `src/` の実装、テスト、Web Worker、Template保存処理
6. `public/icons/data-shift.svg`
7. `docs/screenshots/` に実在する画像
8. Git remoteと、設定されている場合は公開先

次の品質ゲートを実行してください。

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

開発版または公開版を実ブラウザで操作し、少なくともPaste、Sample Data、Format Detection、Validation、Mapping、Transformation Flow、Diff、Template保存／再利用、Copy、Downloadを確認してください。File Upload、JSON Schema、JSONPath / XPath、Web Worker、Shift-JIS等は、実装が存在するだけで掲載せず、対応範囲を操作またはテストで確認してください。

## 2. 掲載する基本情報

- 作品名：JSON・CSV・XML・YAML変換ツール
- カテゴリ：業務効率化ツール
- サブカテゴリ：データ変換・開発支援
- slug候補：`json-csv-xml-yaml-converter`
- アイコン候補：`public/icons/data-shift.svg`
- 公開URL：実在する本番URLを確認できた場合だけ設定
- GitHub URL：`git remote -v` と到達可能性を確認できた場合だけ設定

現在はlocal-onlyです。URLが未設定ならLinkを非表示にし、仮URL、親repositoryのURL、別作品のURLを流用しないでください。

## 3. 掲載の中心メッセージ

この作品を「JSONをきれいに表示するサイト」として紹介しないでください。中心価値は次のシステム間データ変換Flowです。

```text
異なるシステムのData
  → Validation
  → Nested Mapping
  → Filter / Field Selection / Default Value
  → Type Conversion
  → 別FormatへTransformation
  → Diff確認
  → Copy / Download
  → Template再利用
```

入力データ処理が実際にserverへ送られないことをコードとNetwork panelで確認できた場合は、Local-firstを主要な価値として掲載してください。Webページの配信通信まで完全offlineであるとは表現しないでください。

## 4. 実装確認後に選ぶ機能

次の候補から、完成ツールで確認できた機能だけを掲載してください。

- JSON / CSV / XML / YAMLのPaste、File Upload、Sample Data
- Format自動判定と手動変更
- Pretty Print、Indent 2 / 4、Minify
- Syntax ErrorのLine / Column / Reason
- JSON TreeのCollapse / Expand
- 配列系データのTable View
- JSON ↔ CSVとNested dataのFlatten / Dot notation / JSON String
- JSON ↔ XMLと変換ルール
- JSON ↔ YAML
- CSV Header / Delimiter / Encoding
- Key MappingとNested Mapping
- string / number / boolean / date / nullへのType Conversion
- Filter、Field Selection、Default Value
- Transformation Flow
- Version付きTemplate保存と別データへの再実行
- Before / After、Added / Removed / ChangedのDiff
- JSON Schema ValidationとSchema候補生成
- JSONPath / XPath
- Web Worker等の大容量処理対策
- Copy / Download
- EC API JSONとLegacy XMLのDemo

未実装、未確認、部分対応の機能は、実装済み一覧へ混ぜずLimitationsへ移してください。

## 5. Mappingの説明例

画面と動作を確認できた場合は、次のようなnested path変換を具体例として掲載してください。

```text
customer_name
  → customerName

customer.address.city
  → address.cityName
```

単なるrenameではなく、source pathからtarget pathへ構造を組み替えられる点を説明してください。required、Default Value、変換失敗の挙動は実装に合わせて記述してください。

## 6. スクリーンショット

`docs/screenshots/README.md` の記録と、ディレクトリ内の実ファイルを照合してください。2026-08-13時点では次の7点が存在し、内容を目視確認済みです。

1. `01-input-output-desktop.jpg`
2. `02-tree-view-desktop.jpg`
3. `03-mapping-desktop.jpg`
4. `04-transformation-flow-desktop.jpg`
5. `05-validation-error-desktop.jpg`
6. `06-diff-desktop.jpg`
7. `07-template-desktop.jpg`

将来削除・差し替えられた画像は参照しないでください。画像ごとに、実寸、内容、架空データであること、機密情報がないことを再確認してください。現在の画像はlocal appの証跡なので、公開版と一致すると断定しないでください。画像加工で未実装機能を合成せず、altは「画面の画像」のような説明ではなく、その画像から理解できる操作や状態を記述してください。

## 7. ポートフォリオへ反映する内容

- 一覧カード：作品名、カテゴリ、短い紹介、専用SVGアイコン
- 詳細ページ：解決する課題、利用Flow、Mapping、Validation、Template、Local-first、技術構成、制約
- Gallery：確認済みスクリーンショットだけを使用
- Link：確認済みのDemo URLとGitHub URLだけを表示
- Accessibility：意味のあるalt、keyboard focus、色だけに依存しない状態表示

既存ポートフォリオのデータschema、component、画像配置、命名、responsive breakpoint、lint規則に合わせ、他作品のデータやレイアウトを壊さない最小差分で実装してください。

## 8. 紹介文のたたき台

### 短い紹介

JSON・CSV・XML・YAMLのValidation、Nested Mapping、型変換、Filter、Diff、ExportをGUIでFlow化し、Template再利用できるローカルファースト業務ツール。

### 詳細紹介

システム移行やAPI連携で繰り返す構造化データ変換を、一つのワークベンチで扱う業務効率化ツールです。Format検出とSyntax Validation、Tree / Table表示、Nested Mapping、Flatten、Filter、Type Conversion、Field Selection、Default Value、Diff、別FormatへのExportを処理Flowとして設計できます。FlowはTemplateとして端末内へ保存し、新しいデータへ再実行できます。

この文章もそのまま使用せず、実装と実ブラウザ確認の結果に合わせて削除・修正してください。

## 9. 完了条件

- 掲載内容と実装が一致している
- 未確認のURL、テスト件数、性能値、スクリーンショットを記載していない
- Mapping、Transformation Flow、Validation、Template、Local-firstが中心に伝わる
- Format変換のlossyな制約を隠していない
- PCと狭いviewportで表示を確認した
- ポートフォリオ側のlint、typecheck、test、buildが成功した
- 変更ファイルと確認結果を最終報告にまとめた

Editorは軽量textarea、JSONPath / XPathは画面に示すsubset、Template保存はbrowser-localであることを、必要に応じてLimitationsへ掲載してください。

---

このプロンプトは、将来の掲載作業で実物確認を省略しないためのものです。公開URL、GitHub URL、テスト件数、スクリーンショットの状態は、掲載作業時点の事実で更新してください。
