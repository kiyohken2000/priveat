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
