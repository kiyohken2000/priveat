# scripts

開発用のビルドスクリプト置き場。

## build-foods-json.js — 文科省成分表 Excel → JSON

文部科学省「日本食品標準成分表（八訂）増補2023年」本表 (.xlsx) を、
アプリに同梱する `assets/data/foods.json` に変換します。

### 手順

1. **Excel をダウンロード**

   公式: https://www.mext.go.jp/a_menu/syokuhinseibun/

   本表（収載食品の標準成分）の Excel ファイル（八訂・増補2023年）を取得。
   例: `20230428_kagsei_03.xlsx` などのファイル名（ページ上で適宜変わる）。

2. **`apps/mobile/scripts/data/` に置く**

   ```
   apps/mobile/scripts/data/mext_food_composition.xlsx
   ```

   ファイル名は何でも OK（.xlsx であれば最新のものを自動で選ぶ）。
   `scripts/data/` 配下は `.gitignore` 済み（大きいので git に入れない）。

3. **変換を実行**

   ```bash
   cd apps/mobile
   yarn build-foods
   ```

   出力: `apps/mobile/assets/data/foods.json`

### 出力形式

```json
{
  "source": "日本食品標準成分表（八訂）増補2023年",
  "generated_at": "2026-06-04T12:34:56.000Z",
  "count": 2478,
  "items": [
    {
      "food_code": "01001",
      "name": "アマランサス　玄穀",
      "category": "穀類",
      "kcal_per_100g": 343,
      "protein_per_100g": 12.7,
      "fat_per_100g": 6.0,
      "carb_per_100g": 64.9,
      "salt_per_100g": 0
    },
    ...
  ]
}
```

### トラブルシュート

- **「どのシートからも本表データを検出できませんでした」**
  Excel の構造（シート名・ヘッダ行・列名）が想定と異なる可能性。
  `COLUMN_PATTERNS` の patterns を実際の列名に合わせて調整するか、ログを送ってください。

- **Tr / `(0.1)` の扱い**
  - `Tr`（微量） → `0`
  - `(0.1)` の括弧付き推定値 → `0.1`
  - `-`（未測定） → `null`

- **出典表記**
  出力 JSON の `source` フィールドに「日本食品標準成分表（八訂）増補2023年」を埋めています。
  アプリ内クレジット（設定画面など）で表示する義務あり。

---

## scrape-slism.js + build-slism-foods.js — カロリーSlism スクレイピング (個人利用範囲)

カロリーSlism (https://calorie.slism.jp) を **個人利用範囲** (私的複製、著 30 条) でスクレイピングし、完成料理を `foods_slism.json` として同梱する。八訂は素材中心で完成料理 (ラーメン・寿司・パスタ料理・コンビニ商品) のカバーが弱いため、これを補完するのが目的。

### ⚠️ 重要な制約

- **個人利用専用** — public repo (GitHub) には生 HTML も派生 JSON も commit しない。
  - 生 HTML: `scripts/data/slism_raw/` (`apps/mobile/.gitignore` で `scripts/data/` ごと除外済み)
  - 派生 JSON: `assets/data/foods_slism.json` (`apps/mobile/.gitignore` に追加済み)
- **第三者配布は不可** — 引用要件 (著 32 条) を超えるため、再配布時は Slism 運営の許諾が必要。
- アプリビルドは「foods_slism.json が手元にある人のみ」可能。 clone した第三者は空 stub の状態でビルドする (Slism データなしで動く)。

#### `.easignore` の役割 (EAS Build 用)

EAS Build はデフォルトで `.gitignore` を参照してアップロード対象を決めるため、`.gitignore` にだけ `foods_slism.json` を書くと EAS ビルドにも含まれず、個人デバイス上でも Slism が seed されなくなる。これを回避するため `apps/mobile/.easignore` を用意している:

- `.easignore` は存在すると `.gitignore` を**完全に上書き**するため、`.gitignore` の内容を踏襲しつつ、`assets/data/foods_slism.json` の行**だけ外している**。
- 結果: Git には含まれないが、EAS Build にはアップロードされて seed される。
- 生 HTML (`scripts/data/`) は `.easignore` でも除外している (約 500 MB あり、派生 JSON だけで seed には十分なため)。

### 手順

1. **sitemap 取得 + URL リスト作成** (一発)

   ```bash
   cd apps/mobile
   node scripts/scrape-slism.js sitemap
   ```

   出力: `apps/mobile/scripts/data/slism_urls.json` (約 6,690 件、料理 URL のみ filter 済み)

2. **HTML 取得** (resumable、約 2.7 時間 @ 1.5 sec/req)

   ```bash
   node scripts/scrape-slism.js fetch
   # ドライランは: node scripts/scrape-slism.js fetch --limit 10
   # 進捗確認は:   node scripts/scrape-slism.js status
   ```

   出力: `apps/mobile/scripts/data/slism_raw/{id}.html`

   レート: 1.5 sec/req (穏当)、User-Agent に `PriveatPersonalUseScraper/1.0 (personal use only, contact: ...)` を明示。エラー時は最大 2 回 retry。既存ファイルは skip するので途中中断 → 再開可能。

3. **JSON 化**

   ```bash
   node scripts/build-slism-foods.js
   # 1 件デバッグ: node scripts/build-slism-foods.js --debug 200168
   ```

   出力: `apps/mobile/assets/data/foods_slism.json` (約 6,690 件、~2 MB)

   各 HTML の `<script type="application/ld+json">` (`schema.org/NutritionInformation`) を抜いて servingSize 基準を 100g 換算。八訂と同じスキーマで出力 (`food_code='slism_{id}'` で衝突回避)。`sodiumContent` は Slism が「食塩相当量 (g) を mg 表記」しているので 1000 で割って g に戻す (schema.org 本来の Na 解釈とは異なる)。

### スキーマ

```json
{
  "source": "カロリーSlism (https://calorie.slism.jp) — 個人利用範囲",
  "generated_at": "...",
  "count": 6690,
  "items": [
    {
      "food_code": "slism_200168",
      "name": "ペペロンチーノ",
      "alt_name": "ペペロンチーノパスタ",
      "category": "主食",
      "kcal_per_100g": 180.9,
      "protein_per_100g": 5.6,
      "fat_per_100g": 5.21,
      "carb_per_100g": 30.52,
      "salt_per_100g": 1.8,
      "fiber_per_100g": 3.05,
      "serving_size_g": 277.5,
      "kcal_per_serving": 502
    }
  ]
}
```

### アプリ統合

- 起動時に `db/seed.js` が `foods.json` (mext) と `foods_slism.json` (slism) の両方を `foods` テーブルに seed。`source` 列で区別。
- `db/search.js` の `searchFoodsByName` は `alt_name` (Slism 別名) も検索対象に含め、八訂 (`source='mext'`) を優先するソート。
- `foods_slism.json` が空 stub (`count=0`) のときは Slism seed をスキップ (= 八訂のみで動作)。
