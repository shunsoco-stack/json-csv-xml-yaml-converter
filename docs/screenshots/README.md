# ポートフォリオ用スクリーンショット記録

完成した「JSON・CSV・XML・YAML変換ツール」をCodex in-app browserで操作し、2026-08-13に撮影したPNGです。指定された7画面がすべて存在し、実寸、ファイルサイズ、表示内容を目視確認しています。

画像内の注文、顧客名、住所、IDは組込みDemo用の架空データです。実在する企業のデータ、credential、API token、private URLは含みません。

## 確認済みの7画面

| 優先 | ファイル | 実寸 | サイズ | 目視確認した内容 | 推奨alt | 状態 |
| ---: | --- | ---: | ---: | --- | --- | --- |
| 1 | `01-input-output-desktop.jpg` | 1265 × 712 | 91,549 bytes | EC API JSON 3 recordsをMapping・Filterし、CSV 2 recordsへ変換。Format Detection、Copy / Download、Local-first、右側Flowも表示 | EC APIのJSON入力を2件のCSVへ変換し、ローカル処理表示と変換Flowを並べたワークベンチ | 撮影・目視確認済み |
| 2 | `02-tree-view-desktop.jpg` | 1265 × 900 | 121,994 bytes | 変換後2 recordsのTreeを展開し、`address.cityName`、number型の`amount`、date変換後の`orderedAt`を表示 | 顧客名、住所、市区町村、金額、注文日時のnested outputを展開したData Tree | 撮影・目視確認済み |
| 3 | `03-mapping-desktop.jpg` | 1265 × 712 | 62,092 bytes | 6 fieldsのMapping Sheet。`customer.address.city → address.cityName`、string / number / date、Default Valueを表示 | 単純なキー変更とnested path、出力型、既定値を6行で設定するMapping Builder | 撮影・目視確認済み |
| 4 | `04-transformation-flow-desktop.jpg` | 1265 × 900 | 120,609 bytes | JSON Input、Validation、JSONPath Extract、Flatten、Mapping、Filter、Type Conversion、Field Selection、CSV Exportを順に表示 | JSONPath抽出からFlatten、Mapping、Filter、型変換、CSV Exportへ続く9-step Transformation Flow | 撮影・目視確認済み |
| 5 | `05-validation-error-desktop.jpg` | 1265 × 712 | 78,761 bytes | invalid JSONに対するLine 3、Column 46、ReasonをEditor、status、Issue Inspectorへ表示。Output / Exportを停止 | JSON構文エラーの3行46列と理由をEditorとValidation Inspectorに表示したエラー画面 | 撮影・目視確認済み |
| 6 | `06-diff-desktop.jpg` | 1265 × 712 | 91,312 bytes | Added 8、Removed 9、Changed 3をpath、Before、Afterとともに色・label・記号で表示 | 変換前後のAdded 8、Removed 9、Changed 3をpath単位で比較する構造Diff | 撮影・目視確認済み |
| 7 | `07-template-desktop.jpg` | 1265 × 712 | 39,004 bytes | `API A → System B`、説明、localStorageへの設定保存を示すTemplate dialog | API AからSystem Bへの変換設定に名前と説明を付けて保存するTemplate dialog | 撮影・目視確認済み |

## 掲載優先順位

一覧カードには専用SVGアイコン `public/icons/data-shift.svg` を使用し、スクリーンショットを小さく切り抜いてアイコンの代わりにしないことを推奨します。

詳細ページの主画像には、作品の中心価値を一画面で説明しやすい `04-transformation-flow-desktop.jpg` または `01-input-output-desktop.jpg` が適しています。

- Mapping：`03-mapping-desktop.jpg`
- Validation：`05-validation-error-desktop.jpg`
- Before / After：`06-diff-desktop.jpg`
- 再利用性：`07-template-desktop.jpg`
- 階層データの可視化：`02-tree-view-desktop.jpg`

## 撮影範囲と制約

- local appのdark appearanceを撮影したもので、公開URLの画面ではありません。
- Browser製品名とversion、OS display scale、撮影対象commitは記録されていません。
- Desktop evidenceのみです。mobile / narrow viewportは実装されていますが、この7枚には含みません。
- 画像は操作状態の証跡です。Network panel、Storage panel、keyboard操作、screen reader、大容量fixtureの証跡ではありません。
- `07-template-desktop.jpg` は保存dialogを示します。保存後の再読み込み・再適用はsource、engine test、Workbench実装と別に確認してください。

## 再撮影手順

1. `npm.cmd run verify` と `npm.cmd run build:sites` を実行する。
2. local buildまたは確認済み公開版を実ブラウザで開く。
3. 組込みEC API JSON / Legacy XML、または機密情報を含まないfixtureだけを使う。
4. 対象の画面状態を実操作で作り、画像編集で未実装機能を合成しない。
5. console error、読み込み中表示の残留、focusの置き忘れ、tooltipの重なり、横切れを確認する。
6. Validation Errorは実際のinvalid dataから発生させ、Line / Column / Reasonが入力位置と一致するか確認する。
7. Templateは保存、再読み込み、別データへの再適用まで確認する。
8. PNGを差し替えたら、実寸、サイズ、日付、表示内容、altを本書と `docs/PORTFOLIO.md` で同期する。

## altの運用

- 画像から読み取れる操作、データ状態、比較対象を書く。
- 前後の本文と同じ説明を過度に繰り返さない。
- 「ツールの画面」「スクリーンショット」のような情報量の少ないaltを避ける。
- 装飾目的で同じ画像を重複表示する場合は、文脈に応じて空altを検討する。
- 画像を再撮影した場合は、上表のaltを実画像に合わせて更新する。
