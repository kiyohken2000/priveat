# ブラッシュアップ計画 — Priveat

> 2026-07-05 作成。リリース済み (v1.0.7 準備中 / 日本のみ配信) のアプリを磨き込むためのタスク集。
> **他の Claude Code セッションがこのファイルを読んで 1 タスクずつ実装する**ことを前提に書いてある。

## このファイルの使い方（実装セッション向け）

1. まず `README.md` → `docs/SPEC_アプリ仕様書.md` §0（設計原則）→ このファイル、の順に読む。
2. 下の一覧から **1 タスクだけ** 選び、タスク詳細の「方針」「対象ファイル」に従って実装する。
3. 完了したらこのファイルのチェックボックスを `[x]` にし、`docs/PROGRESS_進捗表.md` にも実装サマリを追記する。
4. **実機確認が必要なタスク**（🔌 マーク）は、コード実装 + シミュレータで可能な範囲の確認まで行い、実機での最終確認はユーザーに依頼して終了する（勝手に「動作確認済み」と書かない）。
5. コミットは 1 タスク = 1〜数コミット。main 直コミットで可（このリポジトリの慣習）。コミットの前にユーザーへ diff 概要を報告する。

### 絶対に守る設計原則（SPEC §0 の再掲）

- **LLM に数値を発明させない**。カロリー・栄養素・体重は OCR / 食品DB / ユーザー入力から得る。
- **オフラインで完結**する。オンライン必須の機能を足さない。
- **健康データを端末外に出さない**。外部送信・外部SaaS・解析ツールの追加は不可（ユーザー自身の明示操作によるエクスポートは可）。
- apps/mobile と apps/web は workspace 連結なし。**必ず各ディレクトリに cd してから** yarn / コマンドを実行する。

---

## タスク一覧

| ID | 優先度 | タスク | 規模 | 実機 |
|----|--------|--------|------|------|
| B-1 | P0 | ドキュメント整合性の回復（進捗表・SPEC が実装より古い） | 小 | - |
| B-2 | P1 | データのバックアップ / 復元（機種変対応） | 大 | 🔌 |
| B-3 | P1 | 記録リマインダー（ローカル通知） | 中 | 🔌 |
| B-4 | P1 | 食品DB 候補が複数あるときの選択 UI | 中 | 🔌 |
| B-5 | P1 | コーチの数値ハルシネーション対策 | 中 | 🔌 |
| B-6 | P2 | ユニットテスト整備（純ロジック層） | 中 | - |
| B-7 | P2 | GitHub Actions CI（lint / test / web build） | 小 | - |
| B-8 | P2 | 食品検索の FTS5 化 | 中 | 🔌 |
| B-9 | P3 | llama.rn GBNF による parser JSON 崩れゼロ化 | 中 | 🔌 |
| B-10 | P3 | レシピの残食数管理 | 中 | 🔌 |
| B-11 | P3 | マイ食品の per_100g 対応 + 編集時の画像差し替え | 中 | 🔌 |
| B-12 | P3 | lint / format ツールチェーン刷新（eslint 6 → 9 系） | 大 | - |
| B-13 | 監視 | RN の IME 下線リグレッション修正の取り込み確認 | - | 🔌 |

### 新機能（N 系）

| ID | 優先度 | タスク | 規模 | 実機 |
|----|--------|--------|------|------|
| N-1 | P1 | バーコードスキャンでマイ食品を即記録 | 中 | 🔌 |
| N-2 | P1 | 「よく食べるもの」クイック記録 | 中 | 🔌 |
| N-3 | P2 | 連続記録ストリーク + にもにゃんの反応 | 中 | 🔌 |
| N-4 | P2 | 目標体重の達成ペース予測 | 中 | 🔌 |
| N-5 | P2 | 塩分・食物繊維の日次トラッキング | 中 | 🔌 |
| N-6 | P3 | HealthKit / Health Connect への書き出し（双方向化） | 中 | 🔌 |
| N-7 | P3 | ホーム画面ウィジェット（今日の収支） | 大 | 🔌 |

P0 = すぐやる / P1 = ユーザー価値が大きい / P2 = 品質基盤・定着施策 / P3 = 中期・任意。
B-2〜B-5・N-1〜N-5 は互いに独立。B-6 → B-7 の順が望ましい（CI はテストがあってこそ）。

---

## B-1: ドキュメント整合性の回復 `[ ]`

**背景**: 実装がドキュメントを追い越している。他セッションが古い記述を信じて二重実装する事故を防ぐため最初にやる。

確認済みの乖離:

- `docs/PROGRESS_進捗表.md` フェーズ9（VLM）の ①〜⑧ が未チェックのままだが、実装は存在する（`src/scenes/settings/VlmModelTab.js` / `src/state/vlmOrchestrator.js` / Chat.js の `handlePhotoForVision`）。コードと突き合わせて実際に済んでいる項目を `[x]` にし、済んでいない項目は残す。
- フェーズ10「ストア申請準備」が未チェックだが、git log（v1.0.5 / v1.0.6 リリースコミット）と `app.json`（version 1.0.7, versionCode 10）から**既にストア公開済み**。実態に合わせて更新する。
- `docs/SPEC_アプリ仕様書.md` §16「残タスク」も同様に刈り込む。
- `README.md` の docs 一覧に `PLAN_VLM_料理写真認識.md` / `PLAN_VLM_llama_rn.md` とこのファイルが載っていないので追記。
- `zzz_memo.txt` にあるレシピ入力例の依頼は **実装済み**（`Chat.js` ~2813 行の空状態ガイドに無水カレー例あり）。memo の該当ブロックを消してよいかユーザーに確認してから消す。

**DoD**: 進捗表・SPEC・README がコードの実態と一致し、未完了として残るのは本当に未完了の項目だけになる。

---

## B-2: データのバックアップ / 復元（機種変対応） `[ ]` 🔌

**背景**: 全データが端末内 SQLite + ローカル画像にしかない設計（プライバシーの根幹）ゆえに、**機種変更・端末故障でユーザーの全記録が消える**。毎日使うほど価値が貯まるアプリなので、これが現状最大のユーザーリスク。`expo-sharing` は依存に入っているが未使用、`expo-file-system` は導入済み。

**方針**:

- 設定に「データのバックアップ」画面を新設（`src/scenes/settings/BackupScreen.js` + `SettingsStacks.js` + `SettingsHome.js` に行追加）。
- **エクスポート**: 主要テーブルを 1 つの JSON にダンプ → `expo-file-system` で書き出し → `expo-sharing` の share sheet でユーザーが保存先（Files / Drive 等）を選ぶ。端末外に出すのは**ユーザー自身の明示操作**なので設計原則と矛盾しない（画面上にその旨の説明文を置く）。
  - 対象テーブル: `food_log` / `weight_log` / `energy_log` / `chat_messages` / `recipes` / `recipe_ingredients` / `products` / `coach_advice` / `coach_weekly_advice` / profile 系。**`foods` はエクスポートしない**（成分表 + Slism データは初回 seed で再生成される。Slism 分の再配布回避の意味でも含めない）。
  - フォーマットに `{"app":"priveat","schemaVersion":<現行>,"exportedAt":...,"tables":{...}}` のエンベロープを付ける。
  - `image_uri`（ラベル写真等）は v1 では**含めない**（サイズ・パス移行が複雑）。「画像はバックアップ対象外」と画面に明記。パスはエクスポート JSON から除去する。
- **インポート**: document picker（`expo-document-picker` を追加するか、`expo-file-system` + share intent の範囲で可能なら追加なし）で JSON を選択 → エンベロープ検証 → **全置換 or マージをユーザーに選ばせるのは複雑なので v1 は「全置換」のみ**（確認 Alert 2 段階）。schemaVersion が古い場合は既存のマイグレーション（`db/schema.js`）を通す。
- `db/` に `backup.js` を新設し、SELECT/INSERT は既存モジュールの流儀（トランザクション）に合わせる。

**DoD**: エクスポート → アプリ削除・再インストール（または DB リセット）→ インポートで、履歴画面・ホーム・レシピ・マイ食品が復元される。プライバシーポリシー（apps/web の `/privacy`）に「バックアップはユーザー操作でのみ端末外に出る」旨の追記が必要か確認し、必要なら web 側も更新。

---

## B-3: 記録リマインダー（ローカル通知） `[ ]` 🔌

**背景**: 記録アプリは継続が命だが、リマインドが何もない。`expo-notifications` は依存・plugin 導入済みで未使用。オフライン完結のローカル通知だけで実現できる。

**方針**:

- 設定に「リマインダー」画面（または SettingsHome 内セクション）を追加。「毎日 HH:MM に記録を促す通知」のオン/オフ + 時刻設定（`@react-native-community/datetimepicker` 導入済み）。設定は AsyncStorage。
- `expo-notifications` の calendar trigger（毎日繰り返し）でスケジュール。オフ→キャンセル。権限リクエストはトグルをオンにした時のみ。
- 発展（任意・後回し可）: 「その日まだ food_log が 0 件なら通知」のような条件付きは `expo-background-task`（導入済み）が必要になるので v1 ではやらない。無条件の毎日通知で十分。
- 文言例: 「今日の食事はもう記録しましたか？ 🍚」。にもにゃん絡みの文言はユーザーの好みがあるので 1 案入れて確認。

**DoD**: 指定時刻にローカル通知が届き、タップでアプリが開く。オフにすれば止まる。iOS / Android 両対応。

---

## B-4: 食品DB 候補が複数あるときの選択 UI `[ ]` 🔌

**背景**: フェーズ4 の積み残し（進捗表に「候補が複数/不一致のときカード上でユーザーに選択させる → 任意、後段」）。現状 `db/search.js` の `findBestFood` がスコア最上位 1 件を自動採用するため、「牛乳」→ 低脂肪乳、のような取り違えをユーザーが直せるのは名前の再入力だけ。

**方針**:

- `db/search.js` に `findFoodCandidates(name, limit=5)` を追加（`findBestFood` と同じ正規化・スコアリングで上位 N 件を返す。recipe / product / alias / mext / slism を横断）。既存 `findBestFood` の挙動は変えない。
- `FoodCard.js` の品目行に「候補」アクション（マッチ名の隣に ▾ 等）を追加 → タップでボトムシート（`@gorhom/bottom-sheet` 導入済み）に候補リストを表示（名前 / 出典バッジ / 100g or 1食あたり kcal）。
- 選択したら既存の `applyFoodItemPatch` 経路で `matchedFoodId` / `baseKcal` / kcal を再計算して差し替え。`computeKcalFromMatch` を再利用。
- `EditFoodScreen.js`（過去日の編集）にも同じ候補ピッカーを載せられると理想だが、FoodCard 側を先に完成させ、EditFood 対応は規模を見て分割してよい。

**DoD**: 「牛乳200ml」で誤マッチしたとき、カード上の操作だけで正しい候補に差し替えられ、kcal が再計算されて保存される。

---

## B-5: コーチの数値ハルシネーション対策 `[ ]` 🔌

**背景**: 進捗表に残課題として明記（LFM2.5-JP が「17779kcal」のような実在しない数値を出す）。「LLM に数値を発明させない」原則が唯一破れているのが coach 応答。担当は `src/coaching/context.js`（履歴の整形）と `src/coaching/advice.js` / Chat.js coach モードのプロンプト。

**方針**（下ほど強い対策。①②をまず入れ、実測で足りなければ③):

1. **コンテキスト整形の改善**: `context.js` が LLM に渡すサマリを見直す。数値は「摂取 1,850kcal / 消費 2,100kcal / 収支 -250kcal」のようにラベル付き・カンマなし・単位明示で渡す（トークナイズで桁が壊れにくい形式に）。渡していない数値を聞かれたら「データがない」と言わせる指示を追加。
2. **プロンプト強化**: `COACH_ADVICE_SYSTEM_PROMPT` / `COACH_RULES` に「数値はコンテキストに書かれたものだけをそのまま引用する。計算や推定で新しい数値を作らない」を明記 + few-shot 1 例。
3. **出力ポストチェック**: 応答から `\d[\d,]*\s*kcal|kg` を抽出し、コンテキストに存在しない数値（±丸め誤差許容）が含まれていたら 1 回だけ再生成、それでもダメなら数値部分を「記録を確認してください」に置換……までやるかは効果と応答速度を見て判断。まず①②で実測。

**検証**: `BenchmarkScreen.js` に coach 系テストが既にあるので、そこに「数値を聞く質問」ケースを足して before/after を比較できるようにする。

**DoD**: 代表質問（「今週どうだった？」「先週より食べてる？」）で、応答中の数値がすべてコンテキスト由来になる（実機で LFM2.5-JP / qwen3 の主要 coach モデルを確認）。

---

## B-6: ユニットテスト整備（純ロジック層） `[ ]`

**背景**: テストは `__tests__/app.test.js`（レンダリング 1 本）のみ。一方でこのアプリの複雑さは**純関数に集中している**（LLM 出力パース、OCR パース、単位換算、検索スコアリング）。過去にも「few-shot 変更で parser 退化」事故が起きており（進捗表 2026-06-08 の修復記録）、回帰テストの価値が特に高い。jest-expo 設定済みなので導入コストは低い。

**対象**（優先順）:

1. `src/scenes/chat/schema.js` — `parseRecordOutput` / `parseStage2Output` / `flattenWrappedItems` / `extractBetweenBrackets`。実際に観測された LLM の崩れ出力（二重ネスト、kind=unknown で items あり、few-shot 丸コピー等。進捗表に実例が多数記録されている）をフィクスチャ化する。
2. `src/scenes/chat/Chat.js` の `classifyByRules`（export 済み）— 「鶏むね200g→food」「体重68.5kg→weight」「30分で3キロ走った→activity」「5食分のカレー作った→recipe」等。
3. `src/scenes/chat/ocrParsers.js` — `parseLabelText`（g↔8 誤読補正等）と OCR 種別ルーター。
4. `src/utils/mets.js` — kcal 推定式、距離→時間換算、同義語フォールバック。
5. `src/db/search.js` — `normalize` とスコアリング。DB 依存（`getDb`）と純ロジックが同居しているなら、スコアリング部を純関数に切り出してからテスト（**挙動を変えないリファクタに留める**）。
6. `src/data/portionWeights.js` / `src/data/foodAliases.js` — 換算表の整合性（負値・重複キーがない等のスモーク）。

**注意**: Chat.js は巨大ファイルなので、テストのために import すると RN ネイティブ依存で落ちる可能性がある。その場合は `classifyByRules` と stage2 プロンプト群を `src/scenes/chat/classify.js` に切り出す（機械的な移動のみ）。

**DoD**: `cd apps/mobile && yarn test` で 50+ ケースが通る。既存の lint-staged フック（test 実行）が現実的な時間で回る。

---

## B-7: GitHub Actions CI `[ ]`

**背景**: CI なし。husky + lint-staged はあるがローカル任せ。B-6 のテストを腐らせないために薄い CI を敷く。

**方針**:

- `.github/workflows/ci.yml` を新設。push / PR で:
  - mobile: `cd apps/mobile && yarn install --frozen-lockfile && yarn lint && yarn test`
  - web: `cd apps/web && yarn install --frozen-lockfile && yarn build`（tsc -b を含む）
- ネイティブビルド（EAS）は**やらない**（時間・シークレット不要の範囲に留める）。
- `foods_slism.json` は .gitignore 配下なので、seed 依存のテストを書かない/スキップする前提を B-6 と共有。
- Node バージョンは mobile の Expo SDK 56 要件に合わせる（実装時に `apps/mobile/package.json` engines や Expo docs で確認）。

**DoD**: main への push で lint / test / web build が走り、緑になる。

---

## B-8: 食品検索の FTS5 化 `[ ]` 🔌

**背景**: `db/search.js` は正規化 + LIKE（完全→前方→部分）で、9,200 件超（八訂 2,538 + Slism 6,677）に対して毎回テーブルスキャンに近い。進捗表にも「FTS5 は今後」と明記。体感速度と「表記ゆれヒット率」の両方に効く。

**方針**:

- まず expo-sqlite（SDK 56 同梱の SQLite）で FTS5 が有効かを確認するスパイクから始める（`SELECT fts5(?1)` 等で確認）。**無効なら本タスクは「調査結果を進捗表に記録」で終了**してよい。
- 有効なら: `foods_fts` 仮想テーブル（name / alt_name、trigram tokenizer が使えるなら日本語部分一致に最適。なければ unicode61 + 既存の normalize 前処理を併用）を seed 時に構築。
- `findBestFood` / `findFoodCandidates` / `FoodNameInput` のサジェスト（`searchFoodsByName`）を FTS 経由に置き換え。ただし**既存のスコアリング方針（完全一致は八訂優先 / 部分一致は Slism 優先、recipe → product → alias → food の優先順）を維持**する。ここが崩れると過去に潰した「ラーメン → 中華めん ゆで」系の誤マッチが再発する。
- B-6 のテストがあれば安全に進められるので、**B-6 の後に着手推奨**。

**DoD**: サジェスト・findBestFood の結果が現行と同等以上（既存テストが通る）で、検索の実測レイテンシが改善する。

---

## B-9: llama.rn GBNF による parser JSON 崩れゼロ化 `[ ]` 🔌

**背景**: 進捗表の残課題。llama.rn には文法制約（GBNF）があり、LFM2.5-JP / Gemma3 の parser 出力を構文レベルで JSON に強制できる。executorch 経路には効かないので **llama.rn エンジンのときだけ** の改善。2-stage 化（済み）で頻度は下がっているが、ゼロにできる。

**方針**:

- stage2 の kind 別スキーマ（food / weight / activity / recipe）に対応する GBNF 文法を `src/scenes/chat/` 配下に定数定義。
- `src/state/useLlamaRnLLM.js` の `generate` 呼び出しに grammar オプションを通す口を追加（llama.rn の completion API の `grammar` パラメータ。バージョン 0.12.4 での API 名は実装時に node_modules の型/ドキュメントで確認）。
- executorch 経路は現行の jsonrepair フォールバックのまま。engine 分岐は `modelContext` の activeEngine で判定。
- 文法を強制すると **モデルが不得意な枝で低品質トークンを選び続ける**副作用がありうるので、BenchmarkScreen で既存の parser テストセットを grammar on/off 比較してから本採用。

**DoD**: llama.rn parser で JSON パース失敗が BenchmarkScreen の全ケースで 0 になり、品目分解の精度が悪化しない。

---

## B-10: レシピの残食数管理 `[ ]` 🔌

**背景**: 進捗表の残課題（「5食分のうち3食食べた → 残2食」）。まとめ作り運用の実利用で欲しくなる機能。

**方針**:

- schema 拡張（次の version）: `recipes` に `servings_remaining REAL` を追加（NULL = 管理しない、初期値 = servings）。
- 「カレー1食」を記録したとき（`insertFoodLogItems` の `matchedKind='recipe'` 経路）に `servings_remaining` を quantity 分デクリメント（0 未満にはしない）。food_log 行の削除時（DayDetail / EditFoodScreen）は逆にインクリメント。
- `RecipesScreen.js` の一覧に「残 N 食」バッジ、`RecipeEditScreen.js` に残食数の手動修正欄と「作り直した（リセット）」ボタン。
- FoodNameInput のサジェストで recipe 行に残食数を表示、残 0 のときは薄色表示（選択は妨げない — 実際は食べられるので）。

**DoD**: レシピを 1 食記録すると残食数が減り、記録を消すと戻る。一覧・編集画面で残数が見え、リセットできる。

---

## B-11: マイ食品の per_100g 対応 + 編集時の画像差し替え `[ ]` 🔌

**背景**: どちらも #180 の残課題。products は per_serving 前提のため「ヨーグルト 400g パックのうち 200g」が正確に扱えず、「常用量を 1 単位にする」運用ヒントで凌いでいる。画像は新規登録時しか設定できない。

**方針**:

- schema 拡張: `products` に `kcal_per_100g REAL` ほか P/F/C/salt の per_100g 列（または `per_100g_json TEXT` 1 列。既存 foods テーブルの列構成に合わせるのが検索コードと相性が良い）を追加。
- `ProductEditScreen.js` に「100g あたりで登録」の切替（ラベル OCR は per_100g 表記のことも多いので、`parseLabelText` の結果がどちら基準か選ばせる）。
- `db/search.js` の `adaptProductAsMatch` / `computeKcalFromMatch` を拡張し、per_100g がある product は g 単位指定（「ヨーグルト200g」）でも kcal が出るようにする。
- 画像差し替え: ProductEditScreen の編集モードにも「ラベルを撮影 / 写真から選ぶ」を出し、既存 `imageOcr.js` を再利用。旧画像ファイルの削除は `imageCleanup.js` の流儀に従う。

**DoD**: per_100g 登録したマイ食品が g 指定入力で正しく kcal 計算される。既存 per_serving 品は挙動不変。編集画面で画像を差し替えられる。

---

## B-12: lint / format ツールチェーン刷新 `[ ]`

**背景**: eslint 6 + babel-eslint + airbnb 2020 + prettier 2 + husky 4 は 5 年物。新しい構文で誤検知が出始めたら限界。**機能タスクとは絶対に混ぜない**独立タスク。

**方針**:

- eslint 9（flat config）+ `@babel/eslint-parser` + prettier 3 + husky 9 に更新。airbnb は eslint 9 対応が微妙なので `eslint-config-expo` ベースへの乗り換えを第一候補にする（Expo 公式で将来も追従される）。
- ルール変更で大量の自動修正 diff が出るはず。**「設定更新コミット」と「自動修正コミット」を分ける**。手動修正が要るルールは既存コードに合わせて off にしてよい（このタスクの目的は基盤更新であってコード改変ではない）。
- web 側（apps/web）は既に eslint 10 + flat config なので触らない。

**DoD**: `yarn lint` / lint-staged / pretty-quick が新チェーンで通り、挙動を変える diff が含まれない。

---

## B-13: 【監視】RN の IME 下線リグレッション `[ ]` 🔌

新規実装なし。日本語変換中の下線が出ない問題（進捗表末尾に調査記録あり）は RN Fabric の上流バグで、修正 PR は [facebook/react-native#56082](https://github.com/facebook/react-native/pull/56082)。**Expo SDK / RN をアップグレードする機会があるたびに**この PR の取り込み状況を確認し、取り込まれていたら実機で下線の復活を確認 → 進捗表の「既知の不具合」から消す。マージ済みで SDK 未取り込みなら patch-package での先行適用を検討する。

---

## 新機能タスク詳細

新機能も既存の設計原則（数値を LLM に発明させない / オフライン完結 / 健康データを外に出さない）の内側で選定してある。いずれも LLM 推論を増やさず、既存データ・既存依存パッケージを活かす方向。

---

## N-1: バーコードスキャンでマイ食品を即記録 `[ ]` 🔌

**背景**: `products` テーブルには `barcode TEXT` 列と `idx_products_barcode` インデックスが**最初から用意されているのに、スキャンする UI が存在しない**（ProductEditScreen で手入力できるだけ）。`expo-camera` は導入済みでバーコードスキャン機能を内蔵している。コンビニ食品・市販品を繰り返し食べる運用（このアプリの主要ユースケース）で、2 回目以降の記録が「かざすだけ」になる。

**方針**:

- Chat の画像添付 ActionSheet（既存の 📷 経路）に「バーコードをスキャン」を追加。または Composer に専用アイコン。`expo-camera` の `barcodeScannerSettings`（EAN-13 / EAN-8 = JAN コード）でスキャン画面を実装。
- ヒット時（`db/products.js` に `findProductByBarcode` を新設）: 既存の記録カード（LabelRecordCard 相当）に商品名・kcal を入れて表示 → 個数を確認して `food_log` へ。source は `'barcode'` を新設。
- ミス時: 「未登録の商品です」→ そのまま `ProductEditScreen` を新規モードで開き、barcode をプリセット。ラベル OCR（既存経路）で栄養成分を読ませれば次回からスキャン一発になる、という導線を画面内で案内する。
- **外部バーコード DB（Open Food Facts 等）への照会はしない**（オフライン原則。将来「任意のオンライン補助」として検討する場合も、このタスクには含めない）。

**DoD**: 一度ラベル登録した商品を、バーコードスキャン → 個数確認だけで food_log に記録できる。未登録品はスキャンから登録画面に流れ、barcode が自動で入っている。

---

## N-2: 「よく食べるもの」クイック記録 `[ ]` 🔌

**背景**: 食事記録は同じものの繰り返しが大半（毎朝のヨーグルト、いつものプロテイン）。現状は毎回テキスト入力 → LLM parser（2-stage 化後でも 2〜3 秒 + 送信の手間）を通る。**LLM を介さない再記録経路**を作ると、記録コストが一気に下がり継続率に直結する。DB を見るだけで実装でき、「LLM に数値を発明させない」原則的にも最も安全な経路。

**方針**:

- `db/foodLog.js`（または新設 `db/frequentFoods.js`）に「直近 30 日の food_log を名前で GROUP BY し、頻度順に上位 N 件返す」クエリを追加。`ref_food_id` / `ref_kind` / 直近の quantity・unit・kcal も一緒に返す。
- Chat 記録モードの空状態（既存の入力ガイドの上か下）に、頻度上位 6〜8 件をチップとして表示。タップ → 前回と同じ量で FoodCard を合成（既存の `synthFoodCardMessage` を LLM 抜きで呼ぶ。量はカード上で編集可能なので前回値で十分）→ 既存の即時 `insertFoodLogItems` 経路。
- ホームの「今日の食事」セクション付近にも同じチップ列を置けると理想だが、まず Chat 側だけで完結させ、ホーム側は分割タスクにしてよい。
- 表示名の正規化（「バナナ1本」と「バナナ」の名寄せ）は `name` の完全一致 GROUP BY で始め、凝った名寄せはしない。

**DoD**: よく記録している品目がチップに並び、タップ 1 回（+必要なら量編集）で food_log に記録される。LLM 推論は走らない。

---

## N-3: 連続記録ストリーク + にもにゃんの反応 `[ ]` 🔌

**背景**: 記録アプリの定着はストリーク（連続記録日数）表示が定番だが未実装。マスコット「にもにゃん」の Lottie が 21 種（`assets/lottie/nimonyan/`）あり `AdviceCard` で日替わり表示に使っているだけなので、資産を定着施策に活かせる。B-3（リマインダー）と相性が良いが依存はしない。

**方針**:

- `db/` に「food_log か weight_log か energy_log(source='text'/'manual') が 1 件以上ある日」を記録日とみなす連続日数クエリを追加（今日または昨日を終端とする連続カウント。日付は既存コードのローカル日付規約に合わせる）。計算は表示時にオンザフライで行い、専用テーブルは作らない（ログが真実のソース）。
- ホームのサマリーカード付近に「🔥 連続 N 日」表示。にもにゃん + 吹き出しの既存 UI 部品（`AdviceCard` のマスコット部）を流用し、節目（3 / 7 / 14 / 30 / 100 日）でお祝い文言 + ハプティック。**お祝い文言は定型文の配列から選ぶ（LLM に生成させない — 起動のたびに推論を走らせないため）**。
- ストリークが途切れても責めない文言にする（COACH_RULES のトーン方針と揃える）。「過去最長 N 日」を AsyncStorage に保持して併記。

**DoD**: 毎日記録しているとホームに連続日数が出て、節目でにもにゃんが祝う。1 日空くと 0 に戻り、過去最長は残る。

---

## N-4: 目標体重の達成ペース予測 `[ ]` 🔌

**背景**: `profile` テーブルには `target_weight_kg` / `daily_kcal_target` が最初からあるのに、目標体重は活かされていない（ホームの残りカロリー表示は daily_kcal_target のみ）。体重ログは貯まっているので、**トレンド外挿という純粋な算数**で「このペースなら◯月◯日ごろに目標達成」が出せる。LLM 不使用で設計原則に完全準拠。

**方針**:

- `src/utils/` に `weightTrend.js` を新設: 直近 14〜30 日の `weight_log`（日次最新値）に対する単純線形回帰で 傾き kg/日 を推定。データ 5 日未満・傾きが目標と逆向き・|傾き| が極小、のケースは予測を出さない（「もう少しデータが貯まると予測が出ます」）。
- ホームの最新体重表示のそばに「目標 XX kg まであと Y kg・このペースだと◯月上旬」のような 1 行を追加。日付はピンポイントでなく旬単位に丸める（精度の誤解を与えないため）。
- 履歴の体重推移グラフ（30 日、gifted-charts）に**目標体重の水平ライン**を追加。ProfileScreen に target_weight_kg の入力欄が無ければ追加する（schema には列があるので UI だけの話のはず。実装時に確認）。
- 健康ガード: 推定ペースが週 1kg 超の減量ペースなら「ペースが速すぎるかも」の注意文言（定型文）を添える。

**DoD**: 目標体重を設定すると、ホームに残り kg とペース予測が出て、体重グラフに目標ラインが引かれる。データ不足時は静かに非表示。

---

## N-5: 塩分・食物繊維の日次トラッキング `[ ]` 🔌

**背景**: データは既に持っている。八訂の変換スクリプトは `NACL_EQ`（食塩相当量）をマッピング済み、schema v5 で `foods.fiber_per_100g` を追加済み、`products` にも `salt` 列がある。しかし日次集計・表示は PFC（タンパク質・脂質・炭水化物）のみ。減量と並ぶ健康関心事の塩分（日本の食事は特に過多になりやすい）と食物繊維を、**新規データ取得なしで**見せられる。

**方針**:

- 実装前の確認: `food_log` に salt / fiber の直接列があるか、`PFCBar` の集計（直接列優先 → foods JOIN フォールバック）がどう組まれているかを `db/home.js` / `db/foodLogActions.js` で確認し、同じ 2 段構えで salt / fiber 集計を追加。直接列が無ければ schema 拡張（次 version）で追加し、以後の INSERT 経路（text / OCR / barcode / vision）で値を通す。
- Home / DayDetail の PFCBar の下に「塩分 X.X g / 食物繊維 X.X g」の行を追加。目安値（塩分 7.5g 未満・食物繊維 21g 以上、厚労省「日本人の食事摂取基準」の成人男性値など。**出典を SPEC §13 に追記**）に対する軽いバー or 色分け。
- データが取れない品目（レシピ経由・AI 推定 kcal のみの品目）は分母に入れず「概算」と明示。ゼロ埋めして「塩分ゼロ」と誤解させない。
- コーチのコンテキスト（`coaching/context.js`）に塩分・食物繊維サマリを足すのは B-5 と干渉するので、このタスクでは**表示のみ**に留める。

**DoD**: Home / DayDetail で当日の塩分・食物繊維の概算が見え、目安値との比較ができる。データ欠損品目があるときは概算表示と分かる。

---

## N-6: HealthKit / Health Connect への書き出し（双方向化） `[ ]` 🔌

**背景**: ヘルス連携は現在**読み取り専用**（アクティブエネルギー・体重・歩数を取り込むだけ）。アプリで記録した体重・摂取カロリーを OS のヘルスデータストアに書き戻せば、ユーザーは他の健康アプリ（あすけん以外の体重グラフアプリ等)とも共有でき、**アプリを離れてもデータが手元に残る**（B-2 バックアップの補完にもなる）。HealthKit / Health Connect は端末内ストアなのでプライバシー原則と矛盾しない。

**方針**:

- 書き出し対象は v1 では 2 種に絞る: 体重（`weight_log` の source='text'/'manual'/'ocr' 行。source='health' 行を書き戻すとループするので**絶対に除外**）と、摂取エネルギー（food_log の日次合計 → dietaryEnergyConsumed / nutrition record）。
- iOS: `@kingstinct/react-native-healthkit` の save 系 API + `NSHealthUpdateUsageDescription`（app.json に**既にある**ので文言確認のみ）。Android: `react-native-health-connect` の insertRecords + WRITE 権限を app.json に追加。
- 設定 > ヘルス連携に「Priveat の記録をヘルスケアに書き込む」トグル（デフォルト**オフ**。オンにした時に権限リクエスト）。同期タイミングは既存 `syncHealthToDb` の実行時に書き出しもまとめて行う（`src/health/` の既存構造に従う）。
- 重複防止: 書き出し済み管理（AsyncStorage に最終書き出し日時、または record の metadata/clientRecordId に food_log 由来 ID を入れる）。実装時に各ライブラリの upsert 相当を確認。

**DoD**: トグルをオンにすると、アプリで記録した体重と日次摂取カロリーが Apple ヘルスケア / Health Connect に現れ、二重取り込み（自分が書いたデータを自分で再取り込み）が起きない。

---

## N-7: ホーム画面ウィジェット（今日の収支） `[ ]` 🔌

**背景**: 「残り何 kcal 食べられるか」はユーザーが 1 日に何度も知りたい数字で、ウィジェットに出せばアプリを開く必要すらなくなる。ただし Expo 管理下でのウィジェットは**ネイティブターゲット追加が必要な重量級タスク**なので P3。

**方針**:

- 先にスパイク: iOS は `@bacons/apple-targets`（config plugin で WidgetKit ターゲットを生成）、Android は Glance ベースの config plugin（`react-native-android-widget` が Expo 対応）を調査し、**EAS Build で通るか**を最小構成で確認してから本実装に進む。通らなければ調査結果を進捗表に記録して撤退してよい。
- データ受け渡し: RN 側で今日のサマリー（摂取 / 消費 / 残り）を App Group の shared container (iOS) / SharedPreferences (Android) に書き出し、ウィジェットはそれを表示するだけの純表示型にする（ウィジェット側で SQLite を読まない）。書き出しタイミングは food_log / energy_log の INSERT 系ヘルパに 1 フック足す。
- 表示は 1 サイズ（small / 2x1）から始める。にもにゃん静止画を添えるのは任意。

**DoD**: ホーム画面ウィジェットに「今日: 摂取 / 消費 / 残り」が表示され、アプリで記録すると次の更新サイクルで反映される。

---

## 今回見送ったもの（検討済み・理由付き）

- **多言語化 / グローバル配信対応**: PRIVEAT TECHNOLOGIES 社との商標衝突回避で日本のみ配信の方針（進捗表 2026-06-08 の調査）。改名判断とセットでしか動けないので保留。
- **クラウド同期**: 「健康データを端末外に出さない」の根幹と衝突。B-2 の手動バックアップで代替。
- **エラートラッキング (Sentry 等) / アナリティクス**: 同上（外部送信になる）。
- **Gemma 4 E2B 再評価**: HF gated + thinking mode 問題で費用対効果が低い（進捗表 2026-06-09 追記参照）。公式 Q4_0 の再配布が出たら再考。
- **音声入力**: RECORD_AUDIO を意図的に削除した経緯があり、計画外のまま。
- **チャットからのマイ食品登録**: #180 で「設定 → マイ食品 → 新規追加で代替可能なので必要性を見てから」と判断済み。据え置き。
- **外部バーコード DB 照会（Open Food Facts / JAN コード DB）**: オフライン原則に反する。N-1 は自前 products のみで完結させる。
- **水分記録**: 定番機能だが、食事・体重・カロリー収支という既存データモデルと何も接続せず、schema + UI の追加コストだけが乗る。「あすけん置き換え」のコア価値に寄与しないので見送り。
