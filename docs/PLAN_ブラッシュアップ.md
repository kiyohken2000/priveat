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

P0 = すぐやる / P1 = ユーザー価値が大きい / P2 = 品質基盤 / P3 = 中期・任意。
B-2〜B-5 は互いに独立。B-6 → B-7 の順が望ましい（CI はテストがあってこそ）。

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

## 今回見送ったもの（検討済み・理由付き）

- **多言語化 / グローバル配信対応**: PRIVEAT TECHNOLOGIES 社との商標衝突回避で日本のみ配信の方針（進捗表 2026-06-08 の調査）。改名判断とセットでしか動けないので保留。
- **クラウド同期**: 「健康データを端末外に出さない」の根幹と衝突。B-2 の手動バックアップで代替。
- **エラートラッキング (Sentry 等) / アナリティクス**: 同上（外部送信になる）。
- **Gemma 4 E2B 再評価**: HF gated + thinking mode 問題で費用対効果が低い（進捗表 2026-06-09 追記参照）。公式 Q4_0 の再配布が出たら再考。
- **音声入力**: RECORD_AUDIO を意図的に削除した経緯があり、計画外のまま。
- **チャットからのマイ食品登録**: #180 で「設定 → マイ食品 → 新規追加で代替可能なので必要性を見てから」と判断済み。据え置き。
