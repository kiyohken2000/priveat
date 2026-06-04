# アプリ仕様書 — Priveat（プライベート）

> Claude Code セッションに渡す技術仕様。背景・目的は `PROPOSAL_企画書.md`、進捗は `PROGRESS_進捗表.md` を参照。
> このドキュメントは実装の単一の真実（source of truth）。仕様変更時はここを更新する。

## 0. 最重要の設計原則

**「LLM＝言葉とコーチング、数字＝OCRと食品DB」**

- LLM / VLM は入力（テキスト・写真）の意味理解と、アドバイス・履歴への質問応答だけを担う。
- カロリー・栄養素・体重などの数値は、可能な限り OCR（文字の直接読み取り）と食品DB（公式成分表）から得る。LLMに数値を発明させない。
- この線引きを崩さないこと。精度問題が起きたら「数値生成をLLMに任せていないか」をまず疑う。

## 1. 技術スタック

| 領域 | 採用 | 備考 |
| --- | --- | --- |
| フレームワーク | React Native + Expo | iOS / Android 両対応 |
| ベース | ReactNativeExpoBoilerplate（kiyohken2000） | タブ＋スタックナビ、ローカルストレージの骨組みとして利用。**New Architecture 対応に要更新** |
| ビルド | dev client（development build）＋ EAS Build またはローカル prebuild | **Expo Go は使用不可**（ネイティブモジュールのため） |
| アーキテクチャ | React Native New Architecture | llama.rn・react-native-executorch ともに必須 |
| チャットUI | react-native-gifted-chat | `renderCustomView` / `renderBubble` で食品カードを描画 |
| ローカルLLM（主） | react-native-executorch（useLLM） | テキスト構造化＋コーチング＋VLM。.pte形式。構造化出力・ツールコール公式対応。**実測で llama.rn より高速だったため主軸** |
| ローカルLLM（予備） | llama.rn（llama.cpp バインディング） | フォールバック用に残す。GGUF。GBNF文法でJSON出力を物理的に強制できるのが強み（executorch側でJSONが安定しない場合の保険） |
| VLM（料理写真） | react-native-executorch（useLLM の `capabilities: ['vision']`） | テキストと同じ useLLM で完結。`imagePath`/`mediaPath` で画像を渡す。LFM2.5-VL-1.6B 等が利用可 |
| OCR | rn-mlkit-ocr（ML Kit, 画像URIから読取） | ラベル・スクショの数値読み取り。LLMを介さない。※ agoldis/react-native-mlkit-ocr はアーカイブ済みのため不可 |
| 画像入力 | expo-camera（撮影）＋ expo-image-picker（ギャラリー/スクショ選択） | 撮影もスクショも最終的に画像URIにして OCR に渡す |
| ローカルDB | expo-sqlite | 食品成分表・食事ログ・体重ログ・商品キャッシュ |
| ヘルス連携 | react-native-health-link（iOS HealthKit / Android Health Connect を統一） | 消費カロリー・体重・歩数の自動取得（スクショの代替・補完）。フェーズ6 |
| 食品データ | 文部科学省 日本食品標準成分表（八訂）増補2023年 | 無料・公式・出典記載で利用可。Excel→SQLite変換して同梱 |

### モデル候補（オンデバイス・日本語）

- 形式は **.pte**（executorch用）。Software Mansion の HuggingFace に変換済みモデルあり（Qwen2.5 / Qwen3 / Phi-4 Mini / LLaMA3.2 / SmolLM2 / LFM2.5 など）。
  - ※ GGUF は executorch では使えない（GGUFは予備の llama.rn 側のみ）。
- 開始点: Qwen2.5-1.5B または Qwen3 系（多言語・軽量）。テキスト構造化用。
- VLM（料理写真）: LFM2.5-VL-1.6B など `capabilities: ['vision']` 対応モデル。
- 精度が必要なら Phi-4 Mini（4B）。端末性能に応じてサイズを切り替えられる設計にする。
- 構造化出力は文法強制ではなく「プロンプト指示＋出力の検証・補修」方式（次節参照）。モデル選びは「日本語の理解と食品名の正規化の質」で評価する。

## 2. 全体アーキテクチャ（データの流れ）

```
[入力]                 [処理]                          [格納]
食事の文章   ──→ テキストLLM（構造化）─→ 食品DB照合 ─┐
料理の写真   ──→ VLM（料理名推定）＋ユーザー確認 ─→ 食品DB照合 ─┤
食品ラベル   ──→ OCR（栄養成分を直接読取）──────────────┤──→ SQLite（履歴）
消費/体重    ──→ OCR or HealthKit/Health Connect ─────────┘
                                                            │
                                              SQLite ──→ コーチングLLM（傾向分析・助言・履歴Q&A）
```

## 3. 入力の振り分けロジック

チャットに来た入力を種類で判定し、適切な処理に振り分ける。

| 入力種別 | 処理 | 数値の出どころ | 信頼度 |
| --- | --- | --- | --- |
| 食事の文章 | テキストLLMで食品リストに構造化 | 食品DB照合 | 中（量はユーザー確認可） |
| 料理の写真 | VLMで料理名を推定、量はユーザーがタップで確認 | 食品DB（概算）/ 概算テーブル | 低〜中（要確認） |
| 食品ラベルの写真 | OCRで栄養成分表示を読取・パース | ラベルの数値そのまま | 高 |
| 消費カロリー/体重のスクショ | OCRで数値を読取 | スクショの数値そのまま | 高 |
| （連携可能なら）消費/体重 | HealthKit / Health Connect から取得 | OSのヘルスデータ | 高 |

判定の指針: 画像にバーコード／栄養成分表示があればラベル扱い、フィットネスUIならスクショ扱い、料理そのものの写真ならVLM扱い。判定が曖昧なときはユーザーに種別を選ばせる。

## 4. 画面構成

| 画面 | 役割 | 主な要素 |
| --- | --- | --- |
| チャット（入力） | 入力とコーチング会話。AI感を出す主役 | Gifted Chat。食品カード（`renderCustomView`）、写真/スクショ添付（Composer Actions）、量の選択（Quick Replies）、生成待ち（Typing） |
| ホーム（ダッシュボード） | 今日のサマリー | 摂取/消費/収支、目標までの残り、進捗バー、体重最新値 |
| 履歴 | 振り返り | 日別リスト、週別グラフ（カロリー収支・体重推移）、栄養バランス |
| 設定 | 設定 | 目標値、身体情報、モデル選択／ダウンロード、ヘルス連携の許可 |

ナビゲーションはボイラープレートのタブ＋スタックを流用。

## 5. データモデル（SQLite）

> 下記は初期案。実装時に調整可。日付は ISO8601 文字列、カロリーは kcal、重量は g を基本単位とする。

```sql
-- 食品成分表（文部科学省データを変換して同梱・読み取り専用）
CREATE TABLE foods (
  id INTEGER PRIMARY KEY,
  food_code TEXT,            -- 成分表の食品番号
  name TEXT NOT NULL,        -- 食品名
  name_kana TEXT,            -- 読み（あいまい一致用）
  category TEXT,             -- 食品群
  kcal_per_100g REAL,
  protein_per_100g REAL,
  fat_per_100g REAL,
  carb_per_100g REAL,
  salt_per_100g REAL
);
-- 日本語の表記ゆれ対策: FTS5 仮想テーブル or 正規化列＋あいまい一致

-- 市販品キャッシュ（ラベルOCR/バーコードで取得したものを蓄積＝個人用商品DB）
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  barcode TEXT,
  name TEXT NOT NULL,
  kcal REAL, protein REAL, fat REAL, carb REAL, salt REAL,
  serving_desc TEXT,         -- 「1袋(100g)あたり」など
  source TEXT,               -- 'label_ocr' | 'open_food_facts' | 'manual'
  created_at TEXT
);

-- 外食・複合料理の概算テーブル（カツ丼など。少数を同梱＋ユーザー追加）
CREATE TABLE dishes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  default_kcal REAL,
  default_protein REAL, default_fat REAL, default_carb REAL,
  portion_options TEXT       -- JSON: [{"label":"並盛り","factor":1.0}, ...]
);

-- 食事ログ（1食＝1行ではなく、1食品＝1行）
CREATE TABLE food_log (
  id INTEGER PRIMARY KEY,
  eaten_at TEXT NOT NULL,    -- 食事日時
  meal_type TEXT,            -- 'breakfast'|'lunch'|'dinner'|'snack'
  name TEXT NOT NULL,        -- 確定した表示名
  quantity REAL, unit TEXT,  -- 数量・単位
  portion TEXT,              -- 'normal'|'large' など
  kcal REAL, protein REAL, fat REAL, carb REAL, salt REAL,
  ref_food_id INTEGER,       -- foods/products/dishes への参照（任意）
  ref_kind TEXT,             -- 'food'|'product'|'dish'|'manual'
  source TEXT                -- 'text_llm'|'label_ocr'|'vlm'|'manual'
);

-- 体重ログ
CREATE TABLE weight_log (
  id INTEGER PRIMARY KEY,
  measured_at TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  source TEXT                -- 'ocr'|'healthkit'|'manual'
);

-- 消費カロリーログ
CREATE TABLE energy_log (
  id INTEGER PRIMARY KEY,
  logged_at TEXT NOT NULL,
  active_kcal REAL,          -- アクティブエネルギー
  basal_kcal REAL,           -- 基礎代謝（推定）
  steps INTEGER,
  source TEXT                -- 'ocr'|'healthkit'|'manual'
);

-- チャットメッセージ（Gifted Chat の IMessage を永続化）
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  role TEXT,                 -- 'user'|'assistant'
  text TEXT,
  payload TEXT               -- 食品カード等の構造化データ(JSON)。renderCustomView で使用
);

-- 目標・プロフィール（単一行）
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  height_cm REAL, age INTEGER, sex TEXT,
  target_weight_kg REAL,
  daily_kcal_target REAL
);
```

## 6. LLM実装（テキストの構造化）

### 役割

ユーザーの食事の文章を、食品ごとに `name / quantity / unit / portion` に分解して JSON で返す。**カロリーは出させない**（食品DBの仕事）。

### システムプロンプト（雛形）

```
あなたは食事の記述を構造化データに変換するパーサーです。
ユーザーが日本語で書いた食事内容を、食品ごとに分解してJSONで出力してください。

ルール:
- 各食品について name（食品名）, quantity（数量）, unit（単位）を抽出する
- name はできるだけ一般的・標準的な表記に正規化する
- 単位は g / 個 / 本 / 杯 / 枚 / 人前 などから適切なものを選ぶ
- 「大盛り」「少なめ」などの量のニュアンスは portion に入れる
- カロリーや栄養素は絶対に推定しない（数値は別システムが計算する）
- 数量が不明なときは quantity を 1、unit を "人前" とする
- 食べ物以外の文（感想・前置きなど）は無視する
```

### 出力スキーマ（JSON Schema / Zod）

executorch は jsonschema の `Schema` または Zod でスキーマを定義できる。Zodだと出力に型が付くので推奨。

```js
import * as z from 'zod/v4'

const FoodItem = z.object({
  name: z.string().meta({ description: '正規化した食品名' }),
  quantity: z.number().meta({ description: '数量' }),
  unit: z.string().meta({ description: '単位（g/個/本/杯/枚/人前 等）' }),
  portion: z.optional(z.string().meta({ description: '大盛り/少なめ 等' })),
})
const FoodSchema = z.object({ items: z.array(FoodItem) })
```

### executorch（useLLM）呼び出し（雛形）

**重要**: executorch の構造化出力は「文法でデコードを強制する」方式ではなく、**「プロンプトで指示 → 出力を検証・補修」方式**。`getStructuredOutputPrompt(schema)` でフォーマット指示文を作りシステムプロンプトに入れ、生成後に `fixAndValidateStructuredOutput(output, schema)` で補修・検証する。

```js
import {
  useLLM, QWEN3_4B_QUANTIZED,
  getStructuredOutputPrompt, fixAndValidateStructuredOutput,
} from 'react-native-executorch'

const llm = useLLM({ model: QWEN3_4B_QUANTIZED })

// 設定（managed chat）
useEffect(() => {
  const formatting = getStructuredOutputPrompt(FoodSchema)
  const prompt =
    `${SYSTEM_PROMPT}\nユーザーの食事文をJSONで返すこと。ユーザーへの返答はしない。\n${formatting}\n/no_think`
  llm.configure({
    chatConfig: { systemPrompt: prompt },
    generationConfig: { temperature: 0.2 },
  })
}, [])

// 生成完了後にパース
useEffect(() => {
  const last = llm.messageHistory.at(-1)
  if (!llm.isGenerating && last?.role === 'assistant') {
    try {
      const { items } = fixAndValidateStructuredOutput(last.content, FoodSchema)
      // → 食品DB突き合わせへ
    } catch (e) {
      // スキーマ不一致 → 再入力/手入力フォールバック
    }
  }
}, [llm.messageHistory, llm.isGenerating])
```

- 文法強制ではないので絶対の保証はないが、`fixAndValidateStructuredOutput`（ライブラリ内蔵。package.json の `jsonrepair` と同思想）で補修・検証できる。few-shot を足すと精度が上がる。
- Qwen3 系は `/no_think` でリーズニングを無効化できる（構造化タスクでは付ける）。
- **どうしてもJSONが安定しない場合のみ**、予備の llama.rn（GBNF文法でトークン生成段階から物理的にJSONを強制）にこの構造化処理だけ回す。これが llama.rn を残す理由。

### 後処理（食品DB突き合わせ）

1. LLMが返した `name` を正規化（ひらがな/カタカナ統一など）。
2. `foods`（成分表）と `products`（市販品キャッシュ）と `dishes`（外食概算）に対してあいまい一致（FTS5 または編集距離）。
3. 一致候補が複数 or 不一致のときは、チャットの食品カード上でユーザーに選ばせる。
4. 確定したら `quantity` を掛けてカロリー・栄養素を算出し、`food_log` に保存。

## 7. 食品DB戦略（3層）

| 層 | 対象 | 実現方法 |
| --- | --- | --- |
| 1. 素材・基本食品 | ごはん、鶏むね肉、バナナ等 | 文科省 日本食品標準成分表（八訂）増補2023年 を SQLite に同梱。約2,500食品。**出典表記必須**（後述） |
| 2. 市販パッケージ商品 | コンビニ商品等 | ラベルOCRで読取 → `products` にキャッシュして個人用DBを育てる。バーコードがあれば Open Food Facts を任意のオンライン補助に |
| 3. 外食・複合料理 | カツ丼、ラーメン等 | `dishes` 概算テーブル（少数同梱）＋ ユーザーによる確認・カスタム登録。成分表素材の組み合わせ（レシピ）で概算する手も |

## 8. OCR戦略

- ラベル・スクショの数値読み取りは **rn-mlkit-ocr（Google ML Kit, 画像URIから読み取り）** を使う。LLM/VLMは介さない（速く・正確・省メモリ）。
  - ※ 以前広く使われた `agoldis/react-native-mlkit-ocr` は2025/12にアーカイブ済み（作者が rn-mlkit-ocr への移行を案内）。使わないこと。
- 撮影（expo-camera）もギャラリー選択（expo-image-picker）も、最終的に画像ファイルのURIにして OCR に渡す。これで撮影もスクショも同じ1経路で処理できる。
- OCRモデルは日本の食品ラベル＋数値・英字を読めれば十分なので `["latin", "japanese"]` に限定（アプリサイズ削減。app.json 設定済み）。
- 栄養成分表示は日本の標準様式（エネルギー◯kcal / たんぱく質 / 脂質 / 炭水化物 / 食塩相当量）をパースする正規表現／ルールを用意。
- フィットネスアプリのスクショは「アクティブエネルギー」「歩数」「体重」等のラベル＋数値を抽出。
- **長期的な選択肢**: 個人メンテのラッパーの寿命が不安なら、iOS Vision / Android ML Kit を直接呼ぶ薄い自前ネイティブモジュールへの置き換えも可（OS標準APIは安定）。MVPは rn-mlkit-ocr で素早く立ち上げる。

## 9. ヘルス連携（スクショの代替・補完）

- **react-native-health-link** で iOS HealthKit / Android Health Connect を統一インターフェースで扱う（内部で react-native-health / react-native-health-connect を使用）。
- アクティブエネルギー・体重・歩数を取得。これによりスクショ撮影なしで消費カロリー・体重を自動取得できる。スクショ入力も並行サポート（ユーザーが使い分けられる）。
- **必要なネイティブ設定（フェーズ6で追加）**:
  - iOS: HealthKit の entitlement、`NSHealthShareUsageDescription`（読み取り用途の説明）。書き込みもするなら `NSHealthUpdateUsageDescription`。
  - Android: Health Connect 権限（`READ_ACTIVE_CALORIES_BURNED` / `READ_WEIGHT` / `READ_STEPS` 等）。
  - 設定方法は react-native-health-link のセットアップ手順に従う。
- iOS は大きいモデル用に Extended Virtual Addressing / Increased Memory Limit entitlement を有効化（llama.rn の Expo プラグイン `enableEntitlements` を app.json で設定済み）。

## 10. モデル管理（配布）

- モデル（GGUF, 1〜4GB）はアプリに同梱せず、**初回起動時にダウンロード**。
- ホスティングは Hugging Face（無料）。
- ダウンロード進捗UI、SHA等での整合性確認、再ダウンロード対応。
- 端末性能に応じて推奨モデルを出し分け（設定画面でモデル選択可）。

## 11. ライブラリ統合の注意点

- **New Architecture を有効化**してからネイティブ系（llama.rn等）を入れる。ボイラープレートは非前提なので Expo SDK を新しめに上げる。
- **Expo Go は使わない**。`expo-dev-client` ＋ prebuild/EAS Build で進める。
- **Gifted Chat の `IMessage` 拡張**: 標準の `IMessage` は text/image しか持たない。食品カードを出すため独自フィールド（例 `foodItems`, `dailyTotal`）を付けて拡張し、`renderCustomView` でそのフィールドを読んでカードを描く。LLM出力JSON → 拡張IMessage → renderCustomView の流れ。
- Gifted Chat の依存: react-native-reanimated / react-native-gesture-handler / react-native-safe-area-context / react-native-keyboard-controller を併せて入れる。要件は Expo SDK 50+, iOS 13.4+, Android 5.0+。
- Android は `windowSoftInputMode="adjustResize"`（Expoなら基本不要だが要確認）。

## 12. エラー処理・エッジケース

- LLMが食品を抽出できない/JSONが空 → 「もう一度入力してください」、手入力フォールバック。
- 食品DBに一致なし → 候補提示 → なければ手入力＋カスタム登録（`products`/`dishes` に保存）。
- OCRが数値を取れない → 手入力にフォールバック。
- モデル未ダウンロード／低メモリでロード失敗 → 軽量モデルへの切替を促す。
- オフライン時 → Open Food Facts等のオンライン補助はスキップし、ローカルのみで動作。

## 13. ライセンス・出典遵守（必須）

- 食品成分データ利用時は出典を明記すること:
  「日本食品標準成分表（八訂）増補2023年から引用」
  （アプリ内のクレジット／設定画面等に記載）
- Open Food Facts を使う場合: Open Database License / Database Contents License に従う。API利用は「1呼び出し＝ユーザーによる1実スキャン」が原則。
- 各OSSライブラリのライセンス（llama.rn: MIT、gifted-chat: MIT 等）を遵守し、クレジットを用意。

## 14. 実装順序（概要）

詳細は `PROGRESS_進捗表.md`。原則「土台を一つずつ通す」:

1. ボイラープレートを New Arch 化 → dev client ビルド → 実機起動
2. llama.rn 最小疎通（モデルDL → initLlama → 補完が返る）
3. Gifted Chat 導入 → IMessage 拡張 → 食品カード（renderCustomView）
4. 食品DB（成分表）を SQLite 同梱 → あいまい一致 → カロリー算出
5. OCR（ラベル・スクショ）
6. ヘルス連携（HealthKit / Health Connect）
7. ホーム／履歴画面（ダッシュボード・グラフ）
8. コーチング（履歴Q&A・アドバイス）
9. VLM（料理写真）※後回し可
10. 仕上げ（出典表記・モデル切替・エラー処理）

## 15. 確定した依存構成（package.json / app.json）

現時点で導入済みの主要パッケージ:

- フレームワーク: expo ^56 / react-native 0.85 / react 19（New Architecture, `newArchEnabled: true`）
- ナビゲーション: @react-navigation 各種 / react-native-screens / react-native-safe-area-context
- チャット: react-native-gifted-chat（＋reanimated / gesture-handler / keyboard-controller）
- ローカルLLM（主）: react-native-executorch（＋expo-resource-fetcher）。テキスト構造化・コーチング・VLM すべてを担う。実測で llama.rn より高速。.pte形式。
- ローカルLLM（予備）: llama.rn（app.json に `["llama.rn", { "enableEntitlements": true }]` 設定済み）。GBNF文法が必要になった場合のフォールバック。GGUF形式。
- OCR: rn-mlkit-ocr（app.json で `ocrModels: ["latin", "japanese"]`, `ocrUseBundled: true`）
- 画像入力: expo-camera / expo-image-picker
- DB: expo-sqlite
- ヘルス: react-native-health-link（ネイティブ設定は未／フェーズ6）
- 補助: jsonrepair（LLM JSON崩れ修正）/ react-native-enriched-markdown（コーチング表示）/ react-native-element-dropdown（量選択）

ビルド前提: dev client（Expo Go不可）。iOS deploymentTarget 17.0。

## 16. 残タスク（Claude Code で対応）

> app.json は主要設定が揃ったが、以下が未対応。Claude Code で順次対応する。

### 今すぐ対応すべき軽微な修正

- [ ] **iOS `NSPhotoLibraryUsageDescription` の文言修正**: 現在カメラ用途の文言（「…撮影して…カメラを使用します」）が写真ライブラリのキーに入っている。写真ライブラリ読み取り用途の文言に直す。なお expo-image-picker プラグインの `photosPermission` でも同キーが設定されるため、**重複・矛盾しないよう一本化**する（プラグイン側に寄せるのが無難）。
- [ ] **executorch / llama.rn の役割を確定（解決済みの方針）**: react-native-executorch を主軸（テキスト構造化・コーチング・VLM すべて）とし、llama.rn は GBNF文法が必要になった場合のフォールバックとして残す。両方を意図的に保持するため削除は不要。ただし MVP で llama.rn を一切使わない見込みなら、サイズ削減のため一時的に外す判断もあり（その場合フォールバックは後で再導入）。
- [ ] **axios（^0.21.2）が古い**（既知の脆弱性）。任意の Open Food Facts 照会程度なら `fetch` に置換、または axios 1.x へ更新。
- [ ] **Android `RECORD_AUDIO` 権限**: 音声入力を実装するなら残す、しないなら削除。

### フェーズ6（ヘルス連携）で追加する設定

- [ ] iOS: HealthKit entitlement を有効化、`NSHealthShareUsageDescription`（＋書き込みするなら `NSHealthUpdateUsageDescription`）を追加。
- [ ] Android: Health Connect 権限（`READ_ACTIVE_CALORIES_BURNED` / `READ_WEIGHT` / `READ_STEPS` 等）を追加。
- [ ] react-native-health-link のセットアップ手順に沿って config plugin / prebuild 設定を実施。

### 公開前（フェーズ10）

- [ ] "Priveat" の App Store / Google Play 名称重複・商標確認。
- [ ] 食品成分表の出典表記をアプリ内に実装（「日本食品標準成分表（八訂）増補2023年から引用」）。
- [ ] 各OSSライセンスのクレジット表示。
