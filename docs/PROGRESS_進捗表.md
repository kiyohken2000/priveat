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

### フェーズ4 拡張: カロリーSlism スクレイピング統合 (#120)

八訂は素材中心 (約 2,500 件) で完成料理 (餃子・ラーメン・寿司・パスタ料理・コンビニ商品) のカバー率が低いため、カロリーSlism (約 6,690 件) を **個人利用範囲** で同梱する。public repo には含めない (`.gitignore` 配下)。

- [x] scrape スクリプト (`scripts/scrape-slism.js`): sitemap.xml → URL リスト → 1.5 sec/req で rate-limited fetch、resumable、`scripts/data/slism_raw/{id}.html` に保存
- [x] parser スクリプト (`scripts/build-slism-foods.js`): JSON-LD (`schema.org/NutritionInformation`) を抜いて servingSize 基準を 100g 換算、八訂と同じスキーマで `assets/data/foods_slism.json` を生成
- [x] schema v5: `foods` テーブルに `source` / `alt_name` / `fiber_per_100g` / `serving_size_g` / `kcal_per_serving` 列を追加 (既存行は `source='mext'` で埋める)
- [x] `db/seed.js`: mext + slism を source 別に件数判定して seed (空 stub の場合は Slism seed をスキップ)。**Slism JSON の件数と DB 件数が不一致なら自動的に再 seed** (98→6677 のような件数変動に追随)
- [x] `db/search.js`: `alt_name` (Slism の別名) も検索対象に追加。**score=0 (完全一致) は八訂優先 / score≥1 (前方・部分一致) は Slism 優先** に分岐 (完成料理 query で八訂素材 (中華めん ゆで等) に流れないように)
- [x] `db/search.js` `computeKcalFromMatch`: 単位 g 換算不可で Slism マッチのときは `kcal_per_serving` を使った 1 食分フォールバックを追加 (「ラーメン 1個」「カルボナーラ 1人前」で kcal が出るように)
- [x] `foodAliases.js`: 完成料理エイリアス (ラーメン/中華めん/うどん/そうめん/おにぎり/焼きおにぎり/パスタ/スパゲッティ/マカロニ) を削除 (Slism fuzzy 検索に任せる)。`ラーメン → 醤油ラーメン (slism_200031)` / `カレー → カレーライス (slism_200000)` だけ Slism コード直指しで残す
- [x] ライセンス・出典の docs 反映 (SPEC §7 / §13)
- [x] `.easignore` 追加: `.gitignore` を上書きする形で `foods_slism.json` を EAS Build にだけ含める (Git からは除外、実機 seed には載る)
- [x] 全件 (6,690 件) スクレイピング実行 → 最終ビルド (6,677 件 parse 成功 / 13 件は JSON-LD 欠落でスキップ、約 3.3h)
- [x] 実機確認: 「餃子 → 餃子 (slism_118002, 251kcal)」「ラーメン → 醤油ラーメン (slism_200031, 440kcal)」を確認

**DoD**: 文章入力 → 食品DB照合 → 正しいカロリーがカードに出て、ログに保存される。八訂にない完成料理 (ペペロンチーノ等) も Slism 経由でヒットする。

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
- [x] OCR失敗時 (kind='unknown') の手入力フォールバック → `UnknownOcrCard` で読取テキスト参考 + 食品名/数量/単位/kcal(任意) 編集 → `food_log` に source='ocr_manual' で1行 INSERT。kcal 空欄なら食品 DB 検索で自動補完
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
- [x] 運動・体重の個別行 閲覧/編集 (DayDetail に「運動内訳」「体重内訳」セクション、`EditEnergyScreen` / `EditWeightScreen`、`text`/`manual` のみ編集可、`ocr` は削除のみ、`health` は読み取り専用)
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
- [x] 週次サマリーのアドバイス
  - 履歴画面 (`History.js`) のカロリー収支カード直下に `<AdviceCard period="week" />` を追加
  - 起点 = 今日含む 7 日間 (= 6 日前) を `weekStart` として `coach_weekly_advice` に 1 行キャッシュ (schema v7、`coachWeeklyAdvice.js`)
  - `coaching/advice.js` に `buildAdviceContextForWeek(weekStart)` / `inspectWeeklyAdvice` / `generateWeeklyAdvice` を追加。LLM 用 `kind='weekly'` で「来週へのヒント」を尋ねる
  - `AdviceCard` は `period='day'|'week'` で日次/週次を切替え、タイトル・プレースホルダも分岐
- [x] スタンス自由文入力（設定 > コーチへの指示 = `StanceScreen` → AsyncStorage）
- [x] 過度に否定的にならない・健康的な方向に導くトーン調整（`COACH_RULES`、アドバイス用は `COACH_ADVICE_SYSTEM_PROMPT` で文字数も指定）

**DoD**: 履歴をもとにLLMが質問に答え、アドバイスを返す。✅

---

## フェーズ9: VLM（料理写真）

> **詳細設計**: [`PLAN_VLM_料理写真認識.md`](./PLAN_VLM_料理写真認識.md)
>
> 方針: `react-native-executorch` v0.9.0 (現環境) の VLM 対応 + `LFM2.5-VL-450M-QUANTIZED` を主軸。
> 既存の食品 DB マッチ + FoodCard を再利用し、料理名のみ VLM で抽出、量はデフォルト 1人前 + ユーザー編集。

- [ ] ① モデルレジストリに vision ロール追加 (LFM2.5-VL-450M / 1.6B 登録、ModelScreen に vision タブ)
- [ ] ② `modelRecommendation` に vision 役割の推奨ロジック追加
- [ ] ③ ActionSheet に「料理写真として認識」追加、画像 → `llm.sendMessage({imagePath})` 経路の最小実装
- [ ] ④ VLM 応答 → 料理名カンマ split → 既存 `findBestFood` + `computeKcalFromMatch` → FoodCard 表示
- [ ] ⑤ photo mode 入退時の vision モデル自動 swap（parser ⇄ vision）
- [ ] ⑥ 設定で「写真認識モデルを有効化」トグル（初回起動で勝手にダウンロードしない）
- [ ] ⑦ `food_log.source='vision'` 追加、参照箇所点検
- [ ] ⑧ FoodCard に料理名編集 UI を追加（VLM 誤認識の救済）
- [x] ⑩ レシート / 注文履歴画面を VLM で「食べた料理」として認識（#132 撤回後の後続）
  - 画像添付 ActionSheet に「レシート / 注文画面を読み取り」を追加。
  - 既存 `handlePhotoForVision` を `mode: 'dish' | 'receipt'` で分岐。レシートモードは:
    - リサイズ幅 1024 → 1280px (細かい商品名が潰れないように)
    - `n_predict` 64 → 192 (商品数が多くなる前提)
    - system プロンプトを「店名/合計/支払い方法は無視、商品名のみ」に切替
    - `food_log.source = 'receipt_vision'` で料理写真 (`'vision'`) と区別
  - 商品名は DB ヒットしないことが多い (チェーン店メニュー) ため、抽出後は ⑨ の「AI推定」ボタンでまとめて kcal 推定する運用。
- [x] ⑨ DB ミス品の kcal を「AI推定」で補える導線を FoodCard 内に追加（#130 後続）
  - 経緯1: VLM (qwen3-vl-2b-q4) 自身に「料理名:推定kcal」を返させる案は、(a) プロンプト中の例値転記、(b) 角括弧/「料理名:」prefix リーク、(c) `temperature=0.0` で degenerate loop、(d) 「ナスカーラ」「炸き物丼」のような幻覚料理名、(e) 同一トークン列の長尺反復、が頻発し、日本食でもステーキ定食の認識精度自体が悪化したため撤回。
  - 経緯2: parser モデル (Qwen3-0.6B) に kcal 推定を任せたが、 CoT を許容しても英語で推論し材料を誤認 (家系ラーメン → 「rice + beef + sauce」と分解して 370 kcal、ナン → 「1人前 = 1人前のカロリー」と誤訳して 100 kcal)。 0.6B は日本料理の構成知識が乏しく、根本的に精度不足。
  - 採用: VLM は料理名抽出のみに専念。「— kcal」が残るカードには **「AI推定」ボタン** が出て、押下すると **coach モデル (1.7B+) に一時的にスワップ** → カード内の baseKcal==null な item をまとめて推定 → 元のロール (通常 parser) に戻す。ボタンは 2 段階表示 (「コーチモデル読み込み中…」→「AI で推定中…」)。 1 押し ~10-20s 待つが知識量が桁違いに上がる。共通ユーティリティ `utils/aiKcal.js` を EditFoodScreen と Chat 双方で利用。

**DoD**: 料理写真を送ると料理名が推定され、量確認後にカロリーが出て `food_log` に保存される。

---

## フェーズ10: 仕上げ

- [x] 端末性能に応じたモデル切替（設定画面）
  - `utils/modelRecommendation.js`: `getDeviceTier` (4GB/6GB/8GB+ + unknown) と `getRecommendation(model, role, ramBytes)` を実装
  - `ModelScreen`: 端末ティアと役割向けガイダンスを表示するバナーを追加、推奨モデルには「★ 推奨」ピル表示。parser は常に最軽量を推奨、coach はティアに応じて軽量〜高品質を推奨
- [x] 各種ライセンス・出典クレジットの表示（成分表出典を `SettingsHome` の about セクションに記載。マスコットはオリジナル、OSS ライセンス一覧は MVP では省略）
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

- **自炊レシピの登録と再利用 (まとめ作り対応)**
  - 動機: カレー / 作り置き料理を「まとめて作って何食かに分けて食べる」運用を ChatGPT で回している既存ワークフローをアプリに取り込む。`ひき肉500g / 玉ねぎ3個 / トマト缶… で5食分の無水カレー` のように材料リスト + 食数を入力 → 1食あたり kcal を算出 → 「カレー」として保存 → 後日「カレー1食と白米1合とたまご1個」で再利用、というフロー。
  - データ構造案:
    - `recipes (id, name, servings, total_kcal, kcal_per_serving, notes, created_at)`
    - `recipe_ingredients (recipe_id, name, quantity, unit, matched_food_id, kcal)` — 材料を残すと後で見直し・再計算ができる
    - 既存 `products` (ラベル OCR 経由の市販品) と並列の「自炊メニューマスタ」
  - 登録フロー:
    - parser LLM のスキーマに `kind='recipe'` を追加 (FEW_SHOT に 1 例足すだけで動くはず)
    - 出力: `{kind:'recipe', name, servings, ingredients:[{name, quantity, unit}, ...]}`
    - 各 ingredient を `findBestFood` + `computeKcalFromMatch` で kcal 化、DB ミス品は既存「AI推定」ボタン (coach モデル一時スワップ) の経路に乗せる
    - 新 `RecipeCard` で材料編集 / 食数調整 / 1食あたり kcal 確認 / 保存
  - 呼び出しフロー:
    - 「カレー1食と白米1合とたまご1個」→ 既存 food items パスで 3 行に分解
    - `findBestFood('カレー')` の探索範囲に **recipes を優先で含める** → ヒットしたら `kcal_per_serving` を baseKcal に
    - `food_log` 行に `recipe_id` を持たせれば「いつ何食食べたか」も追えるようになる
  - 残課題:
    - 同名衝突: ユーザー自炊「カレー」と Slism の「カレーライス」のどちらを優先するか (自炊優先で良さそう、設定で切替も可)
    - トッピング込み記録: 「カレー1食と白米1合とたまご1個」を 1 食扱いにするか別行のままにするか (現状の 1食品=1行 と整合させるなら別行で良さそう)
    - 残食数管理 (5食分のうち3食食べた → 残2食) は MVP 後のオプション
  - 関連: `db/search.js` (findBestFood の探索範囲拡張), `scenes/chat/schema.js` (kind='recipe' 追加), `db/foodLog.js` (recipe_id 紐付け), `db/schema.js` (v8 マイグレーション)

- **llama.rn テキスト経路の本番統合 — LFM2.5-1.2B-JP を parser/coach で選択可能に**

  ベンチマーク (`BenchmarkScreen.js`) での実機測定の結果、 [`LiquidAI/LFM2.5-1.2B-JP-GGUF`](https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-GGUF) (Q4_K_M, ~731MB) を **llama.rn 経由で parser/coach 両ロールから選べる** ように本番統合する方針が確定。既存の executorch 経路 (Qwen3 / LFM2.5 多言語版 / Qwen3.5) も残す。

  ### 測定結果サマリ (2026-06、実機)

  | テスト | Qwen3 0.6B | Qwen3 1.7B | LFM2.5 1.2B 多言語 | **LFM2.5 1.2B JP** |
  |---|---|---|---|---|
  | parser「カツ丼と缶チューハイ2本」 | 6.3s, 数量伝染 | 15.3s, 単位「本」誤 | 9.4s, 個/缶 妥当 | **2.1s, 単位「本」誤・kcal 0.5 ハルシ** |
  | parser「ごはん大盛りとバナナ1本と焼き魚」 | 12.0s, parse NG (二重ネスト) | 19.5s, kcal 完璧 | 11.2s, kcal 抜け | **2.5s, kcal 完璧 (340/86/150)** |
  | coach「今週どうだった?」 | 2.3s, 文法崩壊 | 6.4s, 自然 | 4.5s, 文法怪しい | **2.0s, 完全に自然 + 具体的数値** |
  | coach「もう少し痩せるには?」 | 2.3s, 抽象的 | 7.7s, 具体的 | 4.3s, 一般的 | **2.9s, 質問返しで丁寧** |
  | coach「今日の調子は?」 | 2.1s, 不自然 | 7.5s, タイ文字混入 | 3.6s, 内容薄い | **1.9s, 自然 (ただし 17779kcal のハルシ)** |

  判断: JP は parser/coach 両用途で **既存 executorch 系より明確に優れている**。特に coach の日本語品質と推論速度 (1.7B の 7-8 倍速で同等以上の精度) は本番投入する価値が大きい。 数値ハルシネーション (17779kcal) は別タスクで coach コンテキスト整形を改善して対応。

  ### 実装計画

  **方針**: ModelScreen の parser/coach セレクタに executorch モデルと llama.rn モデルを並列表示し、ユーザーが engine を意識せず自由に組み合わせ可能にする。 Chat.js / advice.js など下流は engine 抽象化レイヤー越しに同じインターフェースで動く。

  #### Phase 1: useLLM 互換ラッパ `useLlamaRnLLM`
  - executorch の `useLLM` と同じ shape を露出: `isReady` / `isGenerating` / `messageHistory` / `error` / `downloadProgress` / `configure(...)` / `sendMessage(text)` / `generate(messages)` / `interrupt()`
  - llama.rn インスタンスを useEffect で抱え、チャット履歴は自前 state 管理
  - `sendMessage(text)` → 履歴に追加 → `llama.completion({messages: [system, ...history, {role:'user', content: text}], jinja: true})`
  - `generate(messages)` → 単発呼び出し、履歴に触らない (現在のベンチや `aiKcal.js` と同じ用途)
  - 既存 `runWithLlamaRnText` の orchestration ロジックを内部に取り込む

  #### Phase 2: modelContext / LLMProvider 二重化
  - parser/coach 各ロールに `engine: 'executorch' | 'llama_rn'` を持たせる
  - AsyncStorage 新キー: `@priveat/active-parser-engine` / `@priveat/active-coach-engine` (存在しなければ `'executorch'` で起動、後方互換)
  - `LLMProvider` 内で executorch hook と llama.rn hook を **両方常に呼ぶ** (React フックルール準拠)
  - 非アクティブ側は `preventLoad=true` でモデル非保持 → Metal Working Set 制約クリア
  - `LLMContext` は currentRole の engine に応じてどちらかのインスタンスを露出
  - VLM 経路 (`vlmOrchestrator`) は引き続き時間軸排他で 3 エンジン共存

  #### Phase 3: ModelScreen 更新
  - parser タブ / coach タブのモデル一覧に llama.rn モデルも追加
  - 各行に `executorch` / `llama.rn` の engine バッジ
  - DL / 削除 UI は engine 別 (BenchmarkScreen と同じパターンを共有化、ヘルパーを切り出す)
  - 端末 RAM 推奨ロジック (`modelRecommendation.js`) も engine 横断で動くように

  #### Phase 4: 動作確認 + バグ取り
  - parser=llama.rn での Chat.js の「mode=log」フロー (パース結果 → FoodCard) が無変更で動くか
  - mode 切替 (parser↔coach) で履歴復元が動くか
  - 「AI推定」(coach 一時 swap) ロジック: parser=executorch / coach=llama.rn のクロス組み合わせでも動くか
  - 実機 (iOS / Android) で memory leak が無いか、 アンロード後に再ロードできるか

  ### 段階的コミット方針

  1 つの PR で全部入れず、 Phase 1 → Phase 2-3 → Phase 4 で 2-3 commit に分ける。動かない部分があれば revert しやすい。

  ### 関連ファイル

  - `apps/mobile/src/data/llmModels.js` (executorch カタログ) / `data/llmTextModelsLlamaRn.js` (llama.rn カタログ、現状 LFM2.5-1.2B-JP のみ)
  - `apps/mobile/src/state/modelContext.js` (parser/coach swap + preventLlmLoad 排他、 engine 拡張対象)
  - `apps/mobile/src/state/llmTextOrchestrator.js` (`runWithLlamaRnText`、 Phase 1 で useLlamaRnLLM に吸収予定)
  - `apps/mobile/src/services/llmTextModelStorage.js` (GGUF DL/削除、 現状維持)
  - `apps/mobile/src/scenes/settings/ModelScreen.js` (Phase 3 の主要更新先)
  - `apps/mobile/src/scenes/chat/Chat.js` (engine 透過で動くことを Phase 4 で確認、 基本は無変更)

  ### スコープ外 (別タスク)

  - **GBNF 構造化出力**: llama.rn の文法強制で parser の JSON 崩れを 0 にする改善。 まず JP の素の精度を本番で使えるようにする方が優先
  - **coach の数値ハルシネーション対策**: 17779kcal のような誤った数値を防ぐため、 `coaching/context.js` の整形を改善
  - **`.safetensors → .pte` 自前変換**: Liquid AI が公式 `.pte` を出すまでは llama.rn 経路で十分

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
