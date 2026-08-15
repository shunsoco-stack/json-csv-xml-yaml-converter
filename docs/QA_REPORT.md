# QAレポート — JSON・CSV・XML・YAML変換ツール

## 1. 現在の状態

**local品質ゲート・desktop画面証跡・Sites成果物を確認済み / 公開hostingなし**

2026-08-13に、ESLint、TypeScript型チェック、Vitest 31件、production build、Sites成果物生成を実行しました。Codex in-app browserでInput / Output、Tree、Mapping、Transformation Flow、Validation Error、Diff、Template dialogを撮影し、7枚の内容と寸法を目視確認しています。同じbrowserで5,200 recordsと390 × 844も確認しました。公開URLとhosting設定はありません。Network panel、keyboard / screen reader、複数browser等は残余manual確認として区別します。

## 2. 対象

| 項目 | 記録 |
| --- | --- |
| 作品名 | JSON・CSV・XML・YAML変換ツール |
| 対象commit | 未記入 |
| 対象branch | 未記入 |
| 実行日 | 2026-08-13（自動品質ゲート） |
| OS | Windows / PowerShell |
| Node.js | v24.18.0 |
| npm | 11.16.0 |
| Browser | Codex in-app browser。engine / versionは未記録 |
| Desktop capture | 1265 × 712を5枚、1265 × 900を2枚 |
| Mobile / narrow viewport | 390 × 844で主要画面を目視確認 |
| 公開URL | なし。hosting未設定 |

## 3. 品質ゲート

プロジェクトルートで次を実行し、出力と件数を実測値で記録します。

| Gate | Command | 状態 | 結果・証跡 |
| --- | --- | --- | --- |
| Dependency install | `npm.cmd install` またはlockfileがある場合は `npm.cmd ci` | 未実行 | — |
| ESLint | `npm.cmd run lint` | 成功 | error 0、warning 0 |
| TypeScript | `npm.cmd run typecheck` | 成功 | `next typegen && tsc --noEmit` |
| Unit / Integration Test | `npm.cmd test` | 成功 | 3 files、31 tests、31 passed |
| Production Build | `npm.cmd run build` | 成功 | `/`、`/_not-found`、`/icon.svg`、`/manifest.webmanifest` をstatic生成 |
| All gates | `npm.cmd run verify` | 成功 | lint → typecheck → test → buildを連続実行 |
| Sites artifact | `npm.cmd run build:sites` | 成功 | `dist/client/index.html` 62,389 bytes、`dist/server/index.js` 93 bytes |

成功と記録する条件はexit code 0だけではありません。warning、skipped test、想定外のnetwork access、生成物の欠落がないかも確認します。

## 4. 自動テスト確認表

自動テストで確認した範囲と、ブラウザ確認が残る範囲を分けています。「自動確認済み」は全browser・全fixtureでの保証を意味しません。

| 領域 | 最低限の確認内容 | 状態 | 対応test / 備考 |
| --- | --- | --- | --- |
| Format Detection | JSON / CSV / XML / YAMLの候補順位、手動override | 自動・画面確認済み | 4形式のranked detection。画面にAuto / manual selectorと選択状態を確認 |
| JSON | Parse、Pretty Print、Indent 2 / 4、Minify、invalid syntax | 自動確認済み | `engine.test.ts` |
| CSV | Header、Delimiter、quoted field、改行、Encoding、export | 自動確認済み | 引用符、セル内改行、delimiter検出、Shift-JIS fallback |
| XML | Parse、Serialize、root、attribute、text、繰り返し要素、invalid syntax | 自動確認済み | entity往復、DOCTYPE拒否を含む |
| YAML | Parse、Serialize、invalid syntax | 自動確認済み | duplicate key座標を含む |
| JSON ↔ CSV | Flatten、Dot notation、JSON String | 自動確認済み | `engine.test.ts` |
| JSON ↔ XML | 明記した変換規則との一致 | 自動確認済み | root、`@attribute`、配列、serialize |
| JSON ↔ YAML | object、array、primitiveの往復 | 自動確認済み | `engine.test.ts` |
| Path | dot / bracket path、array index、安全でないkeyの拒否 | 自動確認済み | prototype pollution keyを拒否 |
| Mapping | rename、Nested Mapping、required、Default Value、failure | 自動確認済み | flattened literal-dot keyも確認 |
| Flatten | notation、arrayの扱い、collision | 一部自動確認済み | dot / array、literal-dot優先規則を確認。全collision patternは未確認 |
| Filter | 文字列、数値、存在、空値、AND / OR | 自動確認済み | EngineとWorkbench Adapter |
| Field Selection | 指定fieldだけを保持、nested path | 自動確認済み | EngineとWorkbench Adapter |
| Default Value | missing、nullish、empty、指定値 | 自動確認済み | EngineとWorkbench Adapter |
| Type Conversion | string、number、boolean、date、null、failure mode | 自動確認済み | record / path付きfailureを含む |
| Pipeline | Step順序、有効／無効、diagnostic、結果件数 | 自動確認済み | EngineとWorkbench Adapter |
| Diff | Added、Removed、Changed、array / object、identical | 自動確認済み | detail capを含む |
| JSON Schema | Validation、path付きerror、Schema候補生成 | 自動・browser確認済み | Draft-07、Ajv、複数Sample統合。生成後の検証でValidを確認 |
| JSONPath / XPath | 実装が明示する対応subsetとerror | 自動確認済み | wildcardを含むsubset |
| Template | version、保存、読込、削除、別データへの再実行 | 自動・browser確認済み | version 1 / StorageLikeを自動確認。`API A → System B`を保存・再適用しsuccess toastを確認 |
| Worker | request / response、transfer、error、fallback、cancel / restart | 実装確認・ブラウザ待ち | module Worker、export ArrayBuffer transfer、restart / dispose |
| Copy / Download | MIME type、extension、filename、Clipboard failure | 自動・browser確認済み | codec / encoding、Copy / Download success toastを確認。permission failureは未実施 |
| UI | Tree collapse、Table、Builder、Flow、Validation、Diff、Template | 自動・desktop画面確認済み | component testと7枚のlocal browser capture |

## 5. ブラウザ受入確認

### 5.1 EC API JSON → CSV Demo

組込みEC Demoのdesktop evidenceは、`01-input-output-desktop.jpg`、`02-tree-view-desktop.jpg`、`03-mapping-desktop.jpg`、`04-transformation-flow-desktop.jpg`、`06-diff-desktop.jpg` です。

1. Sample DataからEC API JSONを読み込む。
2. FormatがJSONとして判定され、手動変更もできることを確認する。
3. Syntax Validationが成功し、TreeとTableを表示できることを確認する。
4. `customer_name → customerName` とnested pathのMappingを確認する。
5. Flatten、Filter、Type Convert等が表示順に適用されることを確認する。
6. Before / AfterとAdded / Removed / Changedを確認する。
7. CSV設定を選び、Copy / Downloadする。
8. Templateを保存し、別の入力へ再適用する。

状態：**Desktop表示・変換結果・主要Flowを撮影確認済み**。JSON Schemaを生成してAjv ValidationがValidになること、`API A → System B` Templateの保存・再適用、CopyとDownloadのsuccess toastも確認しました。download fileの再読込と別browserでの再適用は追加manual確認です。

### 5.2 Legacy XML → JSON Demo

1. Legacy XML sampleを読み込む。
2. XMLとして自動判定されることを確認する。
3. root、attribute、text、繰り返し要素がREADME記載の規則で表示されることを確認する。
4. JSONへ変換し、Pretty PrintとMinifyを確認する。
5. 変換前後の構造DiffとDownloadを確認する。

状態：**BrowserでLegacy XML 2 records → JSON 2 recordsを確認済み**。Legacy専用screenshotとdownload後の再読込は未実施です。

### 5.3 Validation Error

invalid JSONは、Line 3、Column 46、`Expected double-quoted property name in JSON`をEditor、status、Issue Inspectorへ表示し、Output / Exportを停止する状態を `05-validation-error-desktop.jpg` で確認しました。JSON / CSV / XML / YAMLのdiagnostic座標、Encoding Error、Mapping Failure、Type Conversion Failureは自動テストで確認しています。

状態：**invalid JSONを撮影確認、自動diagnostic 4形式を確認済み**。XML / YAML / CSV errorの個別browser screenshotは未撮影です。

## 6. Local-first確認

| 確認項目 | 状態 | 証跡・備考 |
| --- | --- | --- |
| 入力データを外部endpointへ送るfetch / XHRが実装されていない | Source確認済み | `fetch`、XHR、WebSocket、sendBeaconの実装なし |
| Demo、Paste、File Upload、Transform、Export中のNetwork request | 未確認 | Browser Network panelで確認 |
| 入力データ本体がlocalStorage / sessionStorage / IndexedDBへ残らない | Source確認済み | 入力はReact state。sessionStorage / IndexedDBの実装なし |
| localStorageへ保存する値がTemplate設定だけである | Source確認済み | keyは `data-shift-transform-templates`。Flow設定のみを保存 |
| 再読み込み後に入力データ本体が残らない | 設計確認済み・manual待ち | 入力保存処理はない。入力付きreloadの記録は未取得 |
| READMEと画面上のLocal-first表現が実装と一致する | 確認済み | 7枚すべてにLocal-first / サーバー送信なし表示 |

Webページ本体、font、JavaScript等の配信通信は入力データ送信と分けて記録します。

## 7. Performance / Large Data

件数だけで「対応」を断定せず、fixtureの列数、nest、文字量、端末、処理時間、UIの応答性を記録します。

| Scenario | Fixture | Worker | 状態 | 結果 |
| --- | --- | --- | --- | --- |
| Large JSON parse | 895,385 bytes・5,200 records | Worker使用 | Browser確認済み | 変換後2,600 records |
| Pipeline replay | 同fixture | Worker使用 | Browser確認済み | Filterを含むFlowを完了 |
| Table scroll | 同fixture | N/A | Browser確認済み | virtualized Tableを表示。DOM node実数・処理時間は未記録 |
| Diff | Unit fixture | Protocol対応 | 自動確認済み | Added / Removed / Changedとdetail cap。大量fixtureは未測定 |
| Download | Codec fixture | export ArrayBuffer transfer対応 | 一部自動確認済み | UTF-8 / Shift-JIS codec確認。large downloadは未測定 |

## 8. Accessibility / Responsive

| 項目 | 状態 | 備考 |
| --- | --- | --- |
| Keyboardだけで主要Flowを操作できる | 未確認 | 実browser keyboard auditが必要 |
| focus indicatorが見える | Source・画像確認 | full keyboard sequenceは未実施 |
| dialog / sheetのfocus管理 | 一部確認 | dialog semanticsとautoFocusあり。focus trap / restoreのmanual確認が必要 |
| label、name、role、aria属性 | Source確認済み | tablist、tree、dialog、aria-label等。screen readerは未実施 |
| Errorを色だけで区別しない | 確認済み | label、count、icon、Reasonを併用 |
| Text contrastとdisabled状態 | 画面確認済み | automated contrast測定は未実施 |
| Desktopでpanelが欠けない | 画像確認済み | 1265 × 712 / 900の7枚 |
| 狭いviewportで横切れ・操作不能がない | 目視確認済み | 390 × 844でInput / Studio / Flow切替を確認 |
| prefers-reduced-motion | Source確認済み | animation / transitionを停止するmedia queryあり |
| Light / Dark appearance | 一部確認 | dark capture 7枚、390 × 844、lightはsourceのみ |

Console warning / errorは、上記browser受入確認中に0件でした。

## 9. スクリーンショット証跡

`docs/screenshots/README.md` の7枚すべてについて、ファイルの存在、実寸、file size、表示内容、架空データであることを2026-08-13に確認しました。5枚は1265 × 712、2枚は1265 × 900です。総容量は605,321 bytesです。

状態：**7 / 7 撮影・目視確認済み**。local appのdark desktop evidenceであり、公開版・mobile・Network panelの証跡ではありません。

## 10. 既知の制約・残余manual確認

### 実装上の意図的な制約

- Editorは行番号とdiagnosticを備えた軽量textareaで、CodeMirror / Monaco相当の補完、token coloring、multi-cursorは備えない。
- JSONPathはproperty / index / wildcard / quoted property、XPathは `/` / `//` / `[n]` / attribute / `text()` / `*` のsubsetである。
- XMLのmixed content順序、comment、namespace、CDATA表現、YAML comment・anchor・tagは往復保持しない。
- CSV cellはParse時点ではstringで、必要なfieldへType Conversionを適用する。
- JSON Schema候補生成はSampleから型を保守的に統合するDraft-07候補で、業務ルールを推測しない。
- Templateはbrowser localStorageだけに保存し、cloud同期、共同編集、account管理を行わない。
- 公開hostingと本作品専用Git remoteは設定していない。

### 残余manual確認

- Network panelでの全主要Flow確認
- keyboard、screen reader、複数browser、light appearance
- deep nesting、巨大cell、巨大Schema、大容量fileのmemory上限と処理時間
- Clipboard permission denied、File API failure、download後の再読込
- 壊れたstorage、将来version migration

## 11. 最終判定欄

| 判定 | 記録 |
| --- | --- |
| local portfolio成果物 | 可 |
| 公開release | 対象外。hosting未設定 |
| Blocker | local build、テスト、資料、画像にBlockerなし |
| Non-blocking issue | Network panel、支援技術、複数browser、性能時間の残余確認、公開URLなし |
| 判定日 | 2026-08-13 |
| 判定 | 自動品質ゲート・source review・desktop image review |

公開または対応範囲の拡張を行う場合は、残余manual確認を再評価し、対象commit、browser version、実測fixtureを追記します。
