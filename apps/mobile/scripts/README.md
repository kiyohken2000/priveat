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

## build-foods-supplementary.js — 文科省 別表 (アミノ酸 / 脂肪酸 / 炭水化物) → JSON

文部科学省 成分表の**別表**を JSON 化してアーカイブ化するスクリプト。
本表 (`foods.json`) には kcal / PFC / 食塩しか含まれていないため、
将来「食物繊維 g」「脂質の質 (飽和 vs 不飽和)」「アミノ酸スコア」 などを
扱いたくなった時に取り込めるよう、変換だけ先にやっておく。

**現状アプリでは未使用**。 出力先も `_temp/xlsx_json/` (gitignored) で、
`assets/data/` には入らない (= ビルド成果物に同梱されない)。

### 手順

1. **別表 Excel を `_temp/xlsx/` に置く**

   公式: https://www.mext.go.jp/a_menu/syokuhinseibun/

   別表ファイル (アミノ酸 / 脂肪酸 / 炭水化物の各分冊) を全部 `_temp/xlsx/` 配下に置く。
   `_02` (本表) も含まれていてよいが、本表は `foods.json` と同一内容のため自動でスキップする。

2. **変換**

   ```bash
   cd apps/mobile
   yarn build-foods-supplementary
   ```

   出力: `_temp/xlsx_json/{元ファイル名}.json` (10 ファイル、合計 ~5 MB)

### スキーマ

```json
{
  "source": "日本食品標準成分表（八訂）増補2023年 / 2026-03-27 公開版",
  "table": "炭水化物成分表 (食物繊維)",
  "source_file": "20260327-mxt_kagsei-mext-000029402_14.xlsx",
  "generated_at": "...",
  "count": 1451,
  "identifiers": ["WATER", "FIBSOL", "FIBINS", "FIB-TDF", ...],
  "items": [
    { "food_code": "01001", "name": "アマランサス 玄穀", "category": "01",
      "WATER": 13.5, "FIB-TDF": 7.4, ... }
  ]
}
```

栄養素キーは**文科省の成分識別子をそのまま採用**している (表ごとに違うので独自マッピングは作らない)。
将来取り込む時にこちらでフィールド名を決める。

### 主要識別子の早見表

| 表 | 主な識別子 | 意味 |
|---|---|---|
| `_04` アミノ酸 (可食部 100g) | `ILE` `LEU` `LYS` `MET` `CYS` `PHE` `TYR` `THR` `TRP` `VAL` `HIS` | 必須アミノ酸 (g/100g) |
| `_09` 脂肪酸 (可食部 100g) | `FASAT` / `FAMS` / `FAPU` | 飽和 / 一価不飽和 / 多価不飽和 (g/100g) |
| 〃 | `FAPUN3` / `FAPUN6` | n-3 系 / n-6 系 多価不飽和 (g/100g) |
| 〃 | `F18D2N6` `F20D5N3` `F22D6N3` | リノール酸 / EPA / DHA など個別脂肪酸 |
| `_13` 炭水化物 | `STARCH` `GLUS` `FRUS` `SUCS` `LACS` | でんぷん / ブドウ糖 / 果糖 / ショ糖 / 乳糖 |
| `_14` 食物繊維 | `FIB-TDF` | **総食物繊維 (一番使うやつ)** |
| 〃 | `FIBSOL` `FIBINS` | 水溶性 / 不溶性 |
| `_15` 有機酸 | `LACAC` `OXALAC` `ACEAC` | 乳酸 / シュウ酸 / 酢酸 |

### 取り込みたくなった時の手順 (メモ)

例: 食物繊維 (`FIB-TDF`) を `foods.json` に追加する場合

1. `_temp/xlsx_json/20260327-mxt_kagsei-mext-000029402_14.json` を読み込む
2. `food_code → FIB-TDF` の Map を作る (1451 件、 残り 1087 件は `null`)
3. `build-foods-json.js` 側で `fiber_per_100g` フィールドを追加して出力
4. `assets/data/foods.json` のスキーマと seed 側を合わせて更新

別表は 2538 品目の完全集合ではなく**部分集合** (各 442〜1999 件) なので、
未収載分は `null` 許容 or 別ソース (Slism 等) で補う設計にする必要がある。

---

## scrape-slism.js + build-slism-foods.js — カロリーSlism スクレイピング

カロリーSlism (https://calorie.slism.jp) をスクレイピングし、完成料理を `foods_slism.json` として同梱する。八訂は素材中心で完成料理 (ラーメン・寿司・パスタ料理・コンビニ商品) のカバーが弱いため、これを補完するのが目的。

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
  "source": "カロリーSlism (https://calorie.slism.jp)",
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
