import { getDb } from './index'

// 今日のサマリ用クエリ。`date(..., 'localtime')` でローカル日付に揃える。
// （ISO の Z タイムスタンプは UTC なので、localtime 修飾子を付けないとズレる）。

export const getTodayIntakeKcal = async () => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT COALESCE(SUM(kcal), 0) AS total
       FROM food_log
      WHERE date(eaten_at, 'localtime') = date('now', 'localtime')`,
  )
  return row?.total ?? 0
}

// 同じ日の energy_log が複数ソースで存在する場合は health > ocr > その他 の優先順位で1件採用。
export const getTodayEnergy = async () => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT active_kcal, steps, source, image_uri
       FROM energy_log
      WHERE date(logged_at, 'localtime') = date('now', 'localtime')
      ORDER BY
        CASE source
          WHEN 'health' THEN 1
          WHEN 'ocr' THEN 2
          ELSE 3
        END
      LIMIT 1`,
  )
  return {
    activeKcal: row?.active_kcal ?? null,
    steps: row?.steps ?? null,
    source: row?.source ?? null,
    imageUri: row?.image_uri ?? null,
  }
}

// 今日の食事ログから PFC を算出。
//   優先順位: food_log の直接列 (label OCR が書き込む) > foods JOIN から kcal 比で逆算 (text LLM)。
//   どちらも取れない行は栄養素ゼロ扱い。matchedKcal で「データが取れた割合」を返す。
export const getTodayMacros = async () => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT
       COALESCE(SUM(fl.kcal), 0) AS totalKcal,
       COALESCE(SUM(COALESCE(fl.protein,
                             CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                                  THEN fl.kcal * f.protein_per_100g / f.kcal_per_100g END)), 0) AS protein,
       COALESCE(SUM(COALESCE(fl.fat,
                             CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                                  THEN fl.kcal * f.fat_per_100g / f.kcal_per_100g END)), 0) AS fat,
       COALESCE(SUM(COALESCE(fl.carb,
                             CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                                  THEN fl.kcal * f.carb_per_100g / f.kcal_per_100g END)), 0) AS carb,
       COALESCE(SUM(CASE WHEN fl.protein IS NOT NULL
                          OR fl.fat IS NOT NULL
                          OR fl.carb IS NOT NULL
                          OR (f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL)
                         THEN fl.kcal END), 0) AS matchedKcal
       FROM food_log fl
       LEFT JOIN foods f ON fl.ref_food_id = f.id AND fl.ref_kind = 'food'
      WHERE date(fl.eaten_at, 'localtime') = date('now', 'localtime')`,
  )
  return {
    totalKcal: row?.totalKcal ?? 0,
    matchedKcal: row?.matchedKcal ?? 0,
    protein: row?.protein ?? 0,
    fat: row?.fat ?? 0,
    carb: row?.carb ?? 0,
  }
}

// 今日の食事ログを時刻降順で返す。
export const getTodayMeals = async () => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, eaten_at, name, quantity, unit, kcal, source
       FROM food_log
      WHERE date(eaten_at, 'localtime') = date('now', 'localtime')
      ORDER BY eaten_at DESC`,
  )
  return rows ?? []
}
