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

// 今日の食事ログを時刻降順で返す。
export const getTodayMeals = async () => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, eaten_at, name, quantity, unit, portion, kcal, source
       FROM food_log
      WHERE date(eaten_at, 'localtime') = date('now', 'localtime')
      ORDER BY eaten_at DESC`,
  )
  return rows ?? []
}
