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
- [x] チャットメッセージの永続化（`chat_messages`、**コーチモードの Q&A のみ**）。記録モードは食事ログが成果物として残るので保存しない。DayDetail の「この日のコーチ対話」セクションで日付別に閲覧。

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

### 拡張: 体重・活動量のテキスト入力（multi-intent parser）

OCR 経路だけでなく、`ランニング60分した` `体重68.5kg` のような文章からも体重・活動量を記録できるようにする。①→②→③ の順にコミットを分ける。

- [x] ① parser を multi-intent 化
  - `PARSER_SYSTEM_PROMPT` を拡張し、JSON に `kind` を含めて出力（`food` / `weight` / `activity` / `unknown`）
  - few-shot に体重・活動量の例を追加（活用形正規化、距離指定例 `2キロ歩いた` 含む）
  - `scenes/chat/schema.js` の `parseFoodOutput` を `parseRecordOutput` にリネームし、kind 分岐の土台を作る
  - activity は `duration_min` / `distance_km` のどちらか（または両方）を受け入れる
  - Chat.js の dispatch を kind ごとに分岐（この段階では `kind=food` のみ通し、weight/activity はプレースホルダ）
- [x] ② テキスト経由の体重記録
  - `kind=weight` を受けて `WeightCard` を表示（数値編集 + 「記録する」ボタン）
  - 既存 `insertWeightFromOcr` を削除し `insertWeightLog({weight_kg, source, imageUri?})` に統一（OCR 側も新ヘルパーを使うように差し替え）
  - source 値: テキスト経由は `'text'`
- [x] ③ テキスト経由の活動量記録
  - `utils/mets.js` 新規: 16 種目の辞書。種目ごとに `MET 値` ＋ `想定速度 (km/h)` を持つ
    （ウォーキング・ランニング・ジョギング・サイクリング・水泳・筋トレ・ヨガ・ストレッチ・テニス・サッカー・バスケットボール・登山・ハイキング・縄跳び・ダンス・家事）
  - 同義語フォールバック辞書 (`歩いて` → `ウォーキング` 等) で LLM の活用形ドリフトを救済
  - kcal 推定 `MET × weight_kg × hours × 1.05`
  - `distance_km` だけ来た場合は `想定速度` から duration_min を換算して kcal 計算
  - 体重は `weight_log` 最新から取得、無ければ 60kg デフォルト
  - DB v4 マイグレーション: `energy_log` に `activity_name TEXT` / `duration_min REAL` 列を追加（distance は保存せず分に換算して保存）
  - `kind=activity` を受けて `ActivityCard` を表示（種目・分・推定 kcal を編集 → `energy_log` INSERT、source=`'text'`）
  - 時間を編集すると kcal が自動再計算される (MET × 体重 × 時間 × 1.05)
  - OCR フィットネス側のヘルパー（`insertEnergyFromFitness`）も `insertEnergyLog` の薄ラッパに揃える

**DoD（拡張）**: `ランニング60分した` → 活動量カードに種目・推定 kcal が出て `energy_log` に保存される。`2キロ歩いた` も距離→分換算で保存される。`体重68.5kg` → 体重カードが出て `weight_log` に保存される。

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
- [x] 出典表記の実装（「日本食品標準成分表（八訂）増補2023年（文部科学省）から引用」を設定画面の about セクションに表示）
- [x] AI 応答時にハプティックフィードバック（成功=Success、失敗=Warning）

**DoD**: 文章入力 → 食品DB照合 → 正しいカロリーがカードに出て、ログに保存される。

---

## フェーズ5: OCR（ラベル・スクショ）

- [x] OCRライブラリ導入（rn-mlkit-ocr。app.json で `ocrModels: ["latin","japanese"]` 設定済み）
- [x] 画像入力（expo-image-picker のカメラ/ライブラリ。Composer Actions の📷アイコン + ActionSheet）
- [x] 画像URI → rn-mlkit-ocr で文字認識する共通処理（`scenes/chat/imageOcr.js`、撮影・スクショ両対応）
- [x] 食品ラベルの栄養成分表示パーサー（`ocrParsers.js: parseLabelText`、g↔8 誤読・末尾消失に対応）
- [x] 読取結果を `products` にキャッシュ（`source='label_ocr'`）
- [x] **ラベル OCR → 食品名手動入力 → `food_log` 登録**（`LabelRecordCard` をチャットバブルとして描画。ラベルには食品名が無いことが多いので、ユーザーが名前と個数を入れて「食事として記録」を押すと `insertFoodLogFromLabel` が走る。同時に `products.name` もユーザー入力で上書きして履歴の識別性を確保）
- [x] フィットネスアプリのスクショから消費カロリー/距離/歩数を抽出 → `energy_log`
- [x] 体重スクショから複数行を抽出、最新値を `weight_log` に保存（仕様外だが追加対応）
- [x] OCR種別の自動振り分け（label/weight/fitness/unknown のルーター。kcal の大小文字で label と fitness を区別）
- [x] Composer Actions の📷ボタン（フェーズ2 から繰り越し、OCR と一緒に実装）
- [ ] OCR失敗時 (kind='unknown') の手入力フォールバック → 現状は生テキスト表示まで。LabelRecordCard と同じパターンで「食品名 + kcal を手入力するカード」を出せる余地あり
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
- [x] **ホーム / 今日の DayDetail に「ヘルスケアと同期」ボタン**（`SyncHealthButton`、設定画面まで行かずワンタップで `syncHealthToDb` 実行。最終同期時刻を相対表示、完了時に親画面 reload）

**DoD**: 連携を許可すると、消費カロリーと体重が自動取得される。✅

---

## フェーズ7: ホーム／履歴画面

- [x] ホーム: 今日のサマリー（摂取/消費/収支・残り・進捗バー・最新体重・今日の食事リスト）
- [x] 履歴: 日別リスト（30日、`History.js`）+ 月別カレンダー（`CalendarScreen.js`）
- [x] 履歴: 週別グラフ（カロリー収支7日 + 体重推移30日、`react-native-gifted-charts`）
- [x] 栄養バランス表示（Home / DayDetail に PFCBar、`food_log` 直接列を優先 → 無ければ `foods` JOIN で kcal 比から逆算。ラベル OCR 経由でも反映）
- [x] 過去日の編集・削除（`EditFoodScreen` + DayDetail の削除ボタン）
- [x] DayDetail のヘッダータイトル = 日付（例: "2026年6月5日(金)"、`HistoryStacks.js` で `route.params.date` から動的生成）
- [x] **デフォルトタブをホームに変更**（起動直後の LLM ロード表示を避け、最初に見えるのがデータ画面になるようにする）

**DoD**: 別画面で日別・週別の記録を振り返れる（ChatGPTにない履歴機能の実現）。✅

---

## フェーズ8: コーチング（履歴Q&A・アドバイス）

- [x] 履歴データをLLMに渡すコンテキスト整形（`coaching/context.js` + `advice.js` の date 指定版）
- [x] 「先週より炭水化物多い？」等の履歴質問応答（Chat の coach モード + COACH_SUGGESTIONS）
- [x] 日次のアドバイス生成（Home/DayDetail に `AdviceCard`、ワンショット `llm.generate`、`coach_advice` テーブルでキャッシュ）
  - マスコット表示: `assets/lottie/nimonyan/*.json` 21 種から日付ハッシュで 1 体選び、`AdviceCard` 上部に Lottie + 吹き出し UI で表示（`coaching/mascot.js`）。プレースホルダ状態ではマスコットを非表示
  - 生成成功時にハプティック（`Haptics.NotificationFeedbackType.Success`）
- [ ] 週次サマリーのアドバイス（後段、必要に応じて）
- [x] スタンス自由文入力（設定 > コーチへの指示 = `StanceScreen` → AsyncStorage）
- [x] 過度に否定的にならない・健康的な方向に導くトーン調整（`COACH_RULES`、アドバイス用は `COACH_ADVICE_SYSTEM_PROMPT` で文字数も指定）

**DoD**: 履歴をもとにLLMが質問に答え、アドバイスを返す。✅

---

## フェーズ9: VLM（料理写真）※後回し可

- [ ] VLM モデル（mmproj 経由 or executorch）を導入
- [ ] 料理写真 → 料理名の推定
- [ ] 量はユーザーがタップで確認・調整（`dishes` の portion_options）
- [ ] 食品DB/概算テーブルと接続

**DoD**: 料理写真を送ると料理名が推定され、量確認後にカロリーが出る。

---

## フェーズ10: 仕上げ

- [x] 端末性能に応じたモデル切替（設定画面）
  - `utils/modelRecommendation.js`: `getDeviceTier` (4GB/6GB/8GB+ + unknown) と `getRecommendation(model, role, ramBytes)` を実装
  - `ModelScreen`: 端末ティアと役割向けガイダンスを表示するバナーを追加、推奨モデルには「★ 推奨」ピル表示。parser は常に最軽量を推奨、coach はティアに応じて軽量〜高品質を推奨
- [x] 各種ライセンス・出典クレジットの表示（成分表出典を `SettingsHome` の about セクションに記載。マスコットはオリジナル、OSS ライセンス一覧は MVP では省略）
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
- [x] axios（^0.21.2, 既知の脆弱性）を削除（コード内で未使用だったため `yarn remove axios` で依存ごと除去）
- [x] package.json の `"eject"` スクリプト（廃止コマンド）を削除（履歴上一度も含まれていなかったため対応不要を確認）
- [ ] （フェーズ6）HealthKit / Health Connect の権限・entitlement・説明文を追加（フェーズ6の項目参照）

## 横断的に常に意識すること

- [ ] 「数値をLLMに生成させていないか」を各機能でチェック（OCR/食品DB優先）
- [ ] オフラインで動くか（オンライン補助は任意扱いか）
- [ ] iOS と Android の両方で確認（特にAndroidの性能ばらつき）
- [ ] 健康データを端末外に出していないか（プライバシー）

## メモ・課題（随時追記）

-

### 将来やりたい機能（後回し）

- **週次サマリーへの AI アドバイス**
  - 現在は日次アドバイスのみ (`AdviceCard` + `coach_advice` テーブル)。週次サマリー画面または履歴のカレンダー上から「今週どうだった？」を 1 タップで呼べる導線が欲しい。
  - 関連: `coaching/advice.js` に `buildAdviceContextForWeek(weekStart)` を追加、キャッシュは週単位 (`weekly_advice` テーブル別建て or 同じ coach_advice に week- プレフィックス) を検討。

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
