# 実装計画 — VLM（料理写真からの食事記録）

> Phase 9 の詳細設計。`PROGRESS_進捗表.md` から参照される。
>
> 想定: ユーザーが料理写真を撮影 / ライブラリ選択 → 端末上の VLM が料理名を抽出 → 既存パーサで食品 DB マッチ → FoodCard に表示 → 編集して `food_log` 保存。

## 1. スコープ

**やること**
- 料理写真から「料理名（複数可）」を VLM で抽出
- 既存の `parseRecordOutput` + 食品 DB マッチ + FoodCard を再利用して保存
- 量は写真からは推定せず、デフォルト「1人前」+ ユーザー編集（既存の FoodCard 編集機構をそのまま使う）

**やらないこと（MVP）**
- 量の自動推定（写真に写った物理サイズの推定は精度が出ない）
- ラベル写真の高度な構造化（既存 OCR で十分）
- カメラリアルタイム認識（撮影→確認の方が UX が安定）
- VLM での体重・運動の認識

## 2. 技術選定

### 推論エンジン
**`react-native-executorch` v0.8.0+ で公式 VLM 対応済み**。現在のプロジェクトは v0.9.0 のため追加導入不要。
`llama.rn` の mmproj 経路は予備として保持するが、MVP では使わない。

### モデル候補（執筆時点 2026-06）

| モデル定数 | パラメータ数 | 量子化 | 想定 RAM | 用途 |
|---|---|---|---|---|
| `LFM2_5_VL_450M_QUANTIZED` | 450M | xnnpack 8da4w | ~1GB 程度（要実測） | **主軸候補**。低中スペック端末も対象 |
| `LFM2_5_VL_1_6B_QUANTIZED` | 1.6B | xnnpack 8da4w | ~3GB 程度（要実測） | 高スペック端末向け option |

両方とも `capabilities: ['vision']` で `sendMessage(text, { imagePath })` が使える。LFM2.5 系は多言語対応（日本語含む）と公式が明記。`generationConfig: { temperature: 0.1, minP: 0.15, repetitionPenalty: 1.05 }` がデフォルト。

**初期方針**: `LFM2_5_VL_450M_QUANTIZED` を主軸にして実機で日本語料理の認識精度を確認。450M で「カツ丼」「みそ汁」「ラーメン」「寿司」程度が出れば実用ライン。出なければ 1.6B にステップアップ。

## 3. 既存システムへの統合

### モデルレジストリ
`state/modelContext.js` の現状（parser / coach の 2 ロール）に **`vision` ロールを追加**。`activeModel` を 3 種類管理:

```
parserModel:  Qwen3-0.6B-q  (記録モード用 / 軽量必須)
coachModel:   端末スペックに応じた選択
visionModel:  LFM2.5-VL-450M-q (主軸) / 1.6B-q (option)
```

`getRecommendation(model, role, ramBytes)` の `role` に `'vision'` を追加し、端末ティア別の推奨を返す。

### モデル swap
parser / coach / vision の 3 モデルを **同時に常駐させない**（メモリ厳しい）。現状の parser ⇄ coach swap と同じ仕組みで、**vision mode に入った時にだけ vision モデルをロード**、抜けたら元に戻す。

```
mode='log'    → parser
mode='coach'  → coach
mode='photo'  → vision  ← 新規
```

### Chat の mode 拡張
既存の 2 mode タブ（記録 / コーチに聞く）に「**写真で記録**」を追加するか、既存「記録」モード内に写真入力ボタンを置いて内部で自動 swap するか、UX を選ぶ。

- **案A: 3 モードボタン**: 「記録 / 写真で記録 / コーチ」。明示的でわかりやすいが画面占有が増える
- **案B: 記録モード内の📷ボタン**: 既存 OCR と同じ位置のアイコンで分岐。「写真の中身: 料理 / ラベル / 体重 / フィットネス」を自動振り分け。UX シンプルだが、料理写真のときに parser→vision swap が裏で走る（数秒待ち）
- **案C: ActionSheet 拡張**: 既存📷の ActionSheet を「OCR で読む / 料理写真として認識」の選択にする。明示的だが2階層 UX

→ **案 C 推奨**。既存 OCR は OCR、新規 VLM は VLM と経路を分離。「OCR で読む」が既存の label/weight/fitness/unknown 振り分け、「料理写真として認識」が VLM 経路。

## 4. データフロー

```
[📷 ボタンタップ]
  └ ActionSheet 「OCR / 料理写真として認識」
      └ 「料理写真として認識」選択
          └ カメラ or ライブラリで画像取得 → uri
              └ vision モデルへ swap (configure 切替)
                  └ llm.sendMessage('この料理の名前を日本語で答えて。
                                     複数あればカンマ区切り。料理名以外は書かない',
                                    { imagePath: uri })
                      └ 応答テキスト「カツ丼, みそ汁」
                          └ parseRecordOutput を再利用するために
                            "カツ丼\nみそ汁" として LLM food parser に流すか、
                            または直接 items 配列を組み立てて
                            findBestFood で食品 DB マッチ
                              └ FoodCard 表示（量は 1人前デフォルト、編集可）
                                  └ 既存「food_log INSERT」経路で source='vision' で保存
```

### parser に流すか直接 items を組むか

**案I**: VLM 出力テキストを既存 parser (Qwen3) に流す → 構造化済み → 食品 DB マッチ
- 利点: parser は数量・単位の解釈が得意。「カツ丼1人前」のような文章にして渡せば parser がそのまま分解
- 欠点: parser モデルへの再 swap が必要（vision→parser）、2回 LLM 推論

**案II**: VLM 出力を直接 split して items 配列に展開（量は固定 1人前）
- 利点: 推論 1 回で完結、swap 不要
- 欠点: 数量を VLM に書かせると不正確、汎用性低い

→ **案 II 推奨**。「料理名のカンマ区切り」だけ VLM に求め、量は固定 1人前 + ユーザー編集に倒す。

## 5. UI / UX

### 撮影フロー
1. 「料理写真として認識」を選択
2. カメラ or ライブラリ
3. 撮影後すぐに「認識中…」表示（ActivityIndicator + 画像プレビュー）
4. 数秒〜十数秒（端末次第）後に FoodCard 表示
5. 量をピル編集（既存 small/normal/large 切替）、不要な料理は削除
6. 「保存する」相当のアクション → food_log

※ FoodCard には「料理名を編集」する機構が必要（VLM が間違えた時の救済）。現状の FoodCard は数量・portion 編集はできるが名前変更 UI は無いはず。新規追加検討。

### モデル未ダウンロード時
- 「写真認識モデルをダウンロード中」UI（既存の Qwen3 と同じ download progress 表示を再利用）
- 設定 > LLM モデル に「写真認識」タブを追加 → 450M / 1.6B 選択
- VLM が初回起動時にダウンロードされるとユーザーが驚く可能性 → **設定でユーザーが明示的にロードする方式**にする
  - 設定で「写真認識モデルを有効にする」トグル
  - OFF の状態で写真認識ボタンを押すと「設定から有効化してください」とアラート

## 6. プロンプト設計

```
あなたは料理写真を見て「料理名」を答えるアシスタントです。

ルール:
- 一般的な日本語の料理名で答える（例: カツ丼、ラーメン、みそ汁）
- 写真に複数の料理が写っていれば、カンマ区切りで列挙
- 料理名以外（量、kcal、説明）は絶対に書かない
- 判別できなければ「不明」とだけ書く
```

few-shot は基本不要（VLM はテキスト LLM ほど few-shot に依存しない）。出力フォーマットが揺れる場合のみ追加。

## 7. 実装ステップ（コミット粒度）

| # | 内容 | 想定変更ファイル |
|---|---|---|
| 1 | **モデルレジストリ拡張**: vision ロール追加、LFM2.5-VL-450M を登録、ModelScreen に vision タブ追加 | `state/modelContext.js`, `data/llmModels.js` (新規 or 既存)、`scenes/settings/ModelScreen.js` |
| 2 | **modelRecommendation に vision 追加**: 端末ティア別推奨ロジック | `utils/modelRecommendation.js` |
| 3 | **撮影 → VLM 経路の最小実装**: ActionSheet 「料理写真として認識」追加、画像 → llm.sendMessage 経由で応答ログ確認（カード化はまだ） | `scenes/chat/Chat.js`, `scenes/chat/imageOcr.js` (helper) |
| 4 | **応答テキスト → FoodCard 表示**: 料理名カンマ区切り解析、items 配列組立、findBestFood + computeKcalFromMatch、FoodCard 表示 | `scenes/chat/Chat.js`, `scenes/chat/FoodCard.js` (料理名編集対応) |
| 5 | **vision モデルの自動 swap**: photo mode 入退時にモデル swap | `state/modelContext.js`, `scenes/chat/Chat.js` |
| 6 | **設定でモデル有効化トグル**: 初回起動で勝手にダウンロードしない | `scenes/settings/ModelScreen.js`, `state/modelContext.js` |
| 7 | **food_log source='vision'**: 既存 source 値群に追加、史料への影響確認 | `db/foodLog.js` 周り（source 値の参照箇所点検） |

実装は 1→7 の順。各ステップで実機動作確認してからコミット。

## 8. 検証

### 認識精度の最低ライン
以下の料理写真で「料理名」が正しく出ること:
- 和食: カツ丼、ラーメン、寿司、みそ汁、おにぎり、卵かけご飯
- 洋食: ハンバーガー、パスタ（カルボナーラ）、ピザ、サラダ
- 中華: チャーハン、餃子
- スイーツ・飲み物: ショートケーキ、コーヒー、緑茶

→ 8 割以上で実用とみなす。450M で達成できなければ 1.6B へ。

### パフォーマンス
- 推論時間: 1 枚あたり 10 秒以内（450M の場合）/ 30 秒以内（1.6B）が許容ライン
- メモリ: parser swap → vision で OOM しないこと

## 9. 既存仕様への影響

- `food_log.source` に新値 `'vision'` を追加（migration 不要、TEXT カラム）
- `coaching/context.js` 等で `source` を参照している箇所があれば確認
- `state/modelContext.js` の API が `parserModel` / `coachModel` の 2 軸前提なら `visionModel` 追加で signature 変更が必要

## 10. リスク・未確認事項

- ❓ LFM2.5-VL の日本語料理認識精度は実機検証してみないと不明
- ❓ 450M でも RAM 不足する低スペック端末（4GB 未満）の挙動
- ❓ executorch の `imagePath` が requires absolute file path / file:// URI / Expo の `cache directory URI` のいずれを受け付けるか実機検証必要
- ❓ vision モデルロード中の `useLLM` の挙動（既存 parser とのコンフリクト有無）
- ❓ モデルファイルサイズ（450M xnnpack 8da4w で 200〜400MB 想定だが要確認）→ 初回ダウンロード時間と空き容量 UX

## 参考

- [React Native ExecuTorch v0.8.0 blog](https://swmansion.com/blog/react-native-executorch-v0.8.0-a-library-milestone/)
- [useLLM ドキュメント](https://docs.swmansion.com/react-native-executorch/docs/hooks/natural-language-processing/useLLM)
- [executorch model URLs (LFM2.5-VL)](https://github.com/software-mansion/react-native-executorch/blob/main/packages/react-native-executorch/src/constants/modelUrls.ts)
- [LiquidAI/LFM2.5-VL-1.6B (HuggingFace)](https://huggingface.co/LiquidAI/LFM2.5-VL-1.6B)
- [LFM2.5-VL-450M (Liquid Docs)](https://docs.liquid.ai/lfm/models/lfm25-vl-450m)
