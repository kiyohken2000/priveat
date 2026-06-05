# 進捗表 — Priveat（プライベート）

> Claude Code セッションで作業しながら更新するチェックリスト。完了したら `[x]` にする。
> 設計の根拠は `SPEC_アプリ仕様書.md`、目的は `PROPOSAL_企画書.md`。

## 進め方の原則

- **土台を一つずつ通す**。一度に全部入れず、各フェーズで「動く」を確認してから次へ。
- 各フェーズの末尾に「完了条件（DoD）」を置く。これを満たしたら次フェーズへ。

## ステータス凡例

`[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了 / `[!]` ブロック中

---

## フェーズ0: 土台のセットアップ

- [x] ボイラープレート（ReactNativeExpoBoilerplate）からプロジェクト作成
- [x] Expo SDK を最新安定版に更新
- [x] New Architecture を有効化
- [x] `expo-dev-client` を導入
- [x] dev client をビルド（iOS / Android）
- [x] 実機で dev client が起動することを確認
- [x] 不要なボイラープレート要素（サンプル画面・サインイン等）を整理
- [x] タブ構成を「チャット / ホーム / 履歴 / 設定」に変更

> 補足: 依存パッケージと app.json のプラグイン（expo-image-picker / expo-camera / expo-sqlite / rn-mlkit-ocr / llama.rn）は導入済み。残りの app.json 修正点は末尾「app.json 残設定」を参照。

**DoD**: 自分の dev client が iOS・Android 実機で起動し、4タブの空画面が表示される。

---

## フェーズ1: ローカルLLM 最小疎通

- [x] react-native-executorch を導入（主推論エンジン。＋expo-resource-fetcher）
- [x] llama.rn を予備として保持（app.json に `["llama.rn", { "enableEntitlements": true }]` 設定済み）
- [x] .pte モデルを1つ用意（Qwen3-0.6B 量子化版を選択）
- [x] モデルの初回ダウンロード処理（resource fetcher / 進捗UI）
- [x] `useLLM` でモデルをロード（`isReady` / `downloadProgress` を確認）
- [x] 任意のプロンプトで `generate` の応答が返ることを確認（iOS / Android）
- [ ] 生成速度・メモリを実機で計測（端末別）

**DoD**: 実機でモデルをロードし、テキスト補完が返ってくる。

---

## フェーズ2: チャットUI と食品カード

- [x] react-native-gifted-chat と依存（reanimated / gesture-handler / safe-area-context / keyboard-controller）を導入
- [x] チャット画面に Gifted Chat を表示
- [x] `IMessage` を拡張（`foodItems`, `dailyTotal` 等の独自フィールド）
- [x] `renderBubble` で食品カードを描画（編集可能な行・量のピル・合計バー）※ spec の `renderCustomView` から `renderBubble` に変更（カード全体を吹き出しの代わりにする方が綺麗）
- [x] 量タップでの編集（portion 循環、kcal 再計算）
- [ ] Composer Actions（写真・スクショ添付ボタン）→ フェーズ5（OCR）と一括で実装
- [x] Typing インジケータ（LLM生成待ち表示）
- [ ] チャットメッセージの永続化（`chat_messages`）→ フェーズ4（SQLite）と一括で実装

**DoD**: チャットに送ると、編集可能な食品カードが吹き出し内に表示される（ダミーデータで可）。

---

## フェーズ3: 食事のテキスト構造化（LLM）

- [x] スキーマ定義（plain JSON Schema を採用。zod v4 は executorch が内部で `responseSchema instanceof zCore.$ZodType` を呼び、RN ランタイムで `$ZodType` が undefined になるため不可）
- [x] フォーマット指示文をシステムプロンプトに組込（executorch の `getStructuredOutputPrompt` をバイパスし、同等テンプレを `schema.js` に自前実装）
- [x] 生成後にパース・検証（同じ理由で `fixAndValidateStructuredOutput` を使わず `extractBetweenBrackets + jsonrepair + JSON.parse + 形状チェック` を自前実装）
- [x] few-shot を組み込み正規化精度を確認（4例: と-連結時の単位保持・g 数値保持・portion スコープ・非食品の空配列）
- [x] LLM出力JSON → 拡張IMessage → 食品カード の流れを接続（assistant メッセージは FoodCard で描画、テキスト吹き出しは廃止）
- [x] 抽出失敗・スキーマ不一致時のフォールバック（「食品を抽出できませんでした」を表示）
- [ ] 同一セッション内の chat history 文脈流入対策（毎回 configure リセットで単発抽出化）→ フェーズ4 以降で対応
- [ ] （必要時）JSONが安定しない場合に予備 llama.rn（GBNF文法）へ回す経路を検討

**ユーザー向けに入力ガイドを実装**: 空チャット画面に「おすすめ書き方（箇条書き）」「簡単書き方（と-連結）」「コツ（数量+単位を明示）」を例示することで、モデル精度に頼らない UX 改善も実施。実測で箇条書き入力は完璧に動く。

**DoD**: 「カツ丼と缶チューハイ2本」と送ると、食品リストに分解されカードに出る。

---

## フェーズ4: 食品DB（成分表）と集計

- [x] 文科省 成分表（八訂・増補2023）Excel を取得（ユーザーが手動 DL → `apps/mobile/scripts/data/`）
- [x] Excel → SQLite 変換スクリプト（`scripts/build-foods-json.js`。成分識別子 ENERC_KCAL/PROT-/FAT-/CHOCDF-/NACL_EQ で安定マッピング、2,538食品を JSON 化）
- [x] `expo-sqlite` に成分表を同梱・読込（初回起動時に `assets/data/foods.json` を foods テーブルへ一括 INSERT。進捗UI付き）
- [x] あいまい一致検索（正規化 + LIKE。完全→前方→部分でスコア付け。FTS5 は今後）
- [x] エイリアス辞書（`src/data/foodAliases.js`、~60エントリ）と単位→グラム換算（`src/data/portionWeights.js`、~35食品）を追加
- [ ] 候補が複数/不一致のときカード上でユーザーに選択させる → 任意、後段
- [x] 数量を掛けてカロリー算出（g 直接 + portionWeights 経由）
- [x] `food_log` への保存（portion factor を適用、ref_food_id で foods 紐付け、source='text_llm'）
- [ ] 出典表記の実装（「日本食品標準成分表（八訂）増補2023年から引用」）→ フェーズ10 仕上げで対応
- [x] AI 応答時にハプティックフィードバック（成功=Success、失敗=Warning）

**DoD**: 文章入力 → 食品DB照合 → 正しいカロリーがカードに出て、ログに保存される。

---

## フェーズ5: OCR（ラベル・スクショ）

- [x] OCRライブラリ導入（rn-mlkit-ocr。app.json で `ocrModels: ["latin","japanese"]` 設定済み）
- [x] 画像入力（expo-image-picker のカメラ/ライブラリ。Composer Actions の📷アイコン + ActionSheet）
- [x] 画像URI → rn-mlkit-ocr で文字認識する共通処理（`scenes/chat/imageOcr.js`、撮影・スクショ両対応）
- [x] 食品ラベルの栄養成分表示パーサー（`ocrParsers.js: parseLabelText`、g↔8 誤読・末尾消失に対応）
- [x] 読取結果を `products` にキャッシュ（`source='label_ocr'`）
- [x] フィットネスアプリのスクショから消費カロリー/距離/歩数を抽出 → `energy_log`
- [x] 体重スクショから複数行を抽出、最新値を `weight_log` に保存（仕様外だが追加対応）
- [x] OCR種別の自動振り分け（label/weight/fitness/unknown のルーター。kcal の大小文字で label と fitness を区別）
- [x] Composer Actions の📷ボタン（フェーズ2 から繰り越し、OCR と一緒に実装）
- [ ] OCR失敗時の手入力フォールバック → 任意、後段（現状は振り分け失敗時に生テキストを表示する暫定 fallback）
- [x] AI 応答時のハプティック（成功=Success、失敗=Warning）OCR 経路にも適用

**DoD**: ラベル写真から栄養成分が、スクショから消費カロリー・体重が読み取れる。

---

## フェーズ6: ヘルス連携

- [x] ヘルス連携ライブラリ導入（@kingstinct/react-native-healthkit + react-native-health-connect、react-native-health-link は新アーキ非対応のため離脱）
- [x] iOS: HealthKit entitlement 有効化 ＋ `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` を app.json に追加
- [x] Android: Health Connect 権限（`READ_ACTIVE_CALORIES_BURNED` / `READ_WEIGHT` / `READ_STEPS`）を追加
- [x] iOS HealthKit 連携（アクティブエネルギー・体重・歩数、`queryStatisticsCollectionForQuantity` でネイティブ集計）
- [x] Android Health Connect 連携（raw sample query、Phase 7 で動作確認予定）
- [x] 権限リクエストのUX（設定 > ヘルス連携の「ヘルス連携を許可して同期する」ボタン）
- [x] `energy_log` / `weight_log` への取り込み（日次集計、source='health' で重複防止 upsert、最終同期日時を AsyncStorage に保存）
- [x] スクショ入力との使い分け（source 列で 'ocr' / 'health' / 'manual' を区別）

**DoD**: 連携を許可すると、消費カロリーと体重が自動取得される。✅

---

## フェーズ7: ホーム／履歴画面

- [ ] ホーム: 今日のサマリー（摂取/消費/収支・残り・進捗バー・最新体重）
- [ ] 履歴: 日別リスト
- [ ] 履歴: 週別グラフ（カロリー収支・体重推移）
- [ ] 栄養バランス表示
- [ ] 過去日の編集・削除

**DoD**: 別画面で日別・週別の記録を振り返れる（ChatGPTにない履歴機能の実現）。

---

## フェーズ8: コーチング（履歴Q&A・アドバイス）

- [ ] 履歴データをLLMに渡すコンテキスト整形
- [ ] 「先週より炭水化物多い？」等の履歴質問応答
- [ ] 日次/週次のアドバイス生成
- [ ] 過度に否定的にならない・健康的な方向に導くトーン調整

**DoD**: 履歴をもとにLLMが質問に答え、アドバイスを返す。

---

## フェーズ9: VLM（料理写真）※後回し可

- [ ] VLM モデル（mmproj 経由 or executorch）を導入
- [ ] 料理写真 → 料理名の推定
- [ ] 量はユーザーがタップで確認・調整（`dishes` の portion_options）
- [ ] 食品DB/概算テーブルと接続

**DoD**: 料理写真を送ると料理名が推定され、量確認後にカロリーが出る。

---

## フェーズ10: 仕上げ

- [ ] 端末性能に応じたモデル切替（設定画面）
- [ ] 各種ライセンス・出典クレジットの表示
- [ ] エラー処理・オフライン挙動の総点検
- [ ] アプリアイコンのデザイン（名称は Priveat に確定。`Priv` + `eat` の繋ぎ目を色で分けると由来が伝わる）
- [ ] 公開前: App Store / Google Play での "Priveat" 名称重複・商標の確認
- [ ] （公開する場合）ストア申請準備：Apple Developer / Google Play 登録

**DoD**: 開発者自身が毎日使える品質。あすけん／ChatGPT運用を置き換えられる。

---

## app.json 残設定（Claude Code で対応）

主要設定（newArchEnabled / dev client / expo-image-picker / expo-camera / expo-sqlite / rn-mlkit-ocr / llama.rn プラグイン、各説明文の日本語化、Androidカメラ権限の重複解消）は対応済み。残り:

- [x] iOS `NSPhotoLibraryUsageDescription` の文言修正（expo-image-picker プラグインの `photosPermission` に一本化）
- [x] `splash` を `expo-splash-screen` プラグインに移行、`newArchEnabled` / `packagerOpts` を削除（SDK 52+ スキーマ準拠）
- [x] Android `RECORD_AUDIO` 削除（音声入力は計画外）
- [ ] react-native-executorch を主軸（テキスト・コーチング・VLM）、llama.rn を予備（GBNFフォールバック）として確定済み。両方を意図的に保持。MVPで llama.rn 不使用が確実ならサイズ削減目的で一時的に外す判断のみ検討
- [ ] axios（^0.21.2, 既知の脆弱性）を fetch に置換 or 1.x へ更新
- [ ] package.json の `"eject"` スクリプト（廃止コマンド）を削除
- [ ] （フェーズ6）HealthKit / Health Connect の権限・entitlement・説明文を追加（フェーズ6の項目参照）

## 横断的に常に意識すること

- [ ] 「数値をLLMに生成させていないか」を各機能でチェック（OCR/食品DB優先）
- [ ] オフラインで動くか（オンライン補助は任意扱いか）
- [ ] iOS と Android の両方で確認（特にAndroidの性能ばらつき）
- [ ] 健康データを端末外に出していないか（プライバシー）

## メモ・課題（随時追記）

-

### 将来やりたい機能（後回し）

- **今日のサマリーや履歴の日詳細に「AI からのアドバイス」を表示したい**
  - 設定 → コーチへの指示 (StanceScreen) で入力したスタンスを踏まえて、ホーム画面の今日サマリー / 履歴の DayDetail にコーチ応答を埋め込み表示する。
  - 設計検討事項:
    - 生成タイミング（画面を開いた時に都度生成 / バックグラウンドで先回り生成 / 手動更新ボタン）
    - キャッシュ戦略（同じ日のアドバイスを再生成し続けるのを避ける）
    - parser モデルがロード中（記録用がアクティブ）の時に coach モデルへの swap をどう扱うか
    - 応答は EnrichedMarkdownText で描画（チャット側と統一）
  - 関連: `apps/mobile/src/coaching/context.js` の buildCoachingContext と `prompts.js` の buildCoachSystemPrompt を流用。Day 単位用のコンテキストビルダーを別途用意する手もあり。

### 既知の不具合（後回しでよい）

- **TextInput の IME 未確定文字の下線が出ない**（iOS / Android 両方、全 TextInput が対象）
  - 症状: 日本語入力中、変換確定前の文字の下に表示されるはずの下線（コンポジション underline）が描画されない。プロフィール画面の 1 行 TextInput でも StanceScreen / Chat の multiline でも同じ。
  - 致命的ではない（入力・送信は正常）ので後回し。
  - 切り分け済み:
    - 個別画面の `lineHeight` や `textAlignVertical` を消しても改善しない（アプリ全体の症状なのでスタイル起因ではない）
    - `react-native-keyboard-controller` は依存にあるだけで `KeyboardProvider` ラップ無し（除外）
    - GiftedChat の内蔵 Composer は `lineHeight: 22` を持ち、かつ `react-native-gesture-handler` の TextInput を使っていたため Chat では自前 Composer (`renderComposer`) に置き換え済み（StanceScreen 含め保険として残置）
  - 原因候補:
    1. RN 0.85 + 新アーキ (Fabric) の TextInput コンポジション描画リグレッション（最有力）
    2. React 19.2 との組み合わせ
    3. `react-native-reanimated` 4.x / `react-native-screens` 等の Fabric 実装が干渉
  - 次にやる時の入り口:
    - WebSearch で `react-native 0.85 fabric composition underline ime` の既知 issue 確認
    - `app.json` で新アーキを一時 OFF にした dev build で再現するか
    - 最小再現アプリで切り分け
