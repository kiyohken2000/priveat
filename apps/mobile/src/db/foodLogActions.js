import { getDb } from './index'

// 食事ログがあった日付一覧（カレンダーマーキング用）。'YYYY-MM-DD' の配列。
export const getDatesWithFoodLog = async () => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT DISTINCT date(eaten_at, 'localtime') AS date
       FROM food_log
      ORDER BY date`,
  )
  return (rows ?? []).map((r) => r.date)
}

// 指定日の食事ログ（時刻降順）。
export const getFoodLogByDate = async (date) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, eaten_at, meal_type, name, quantity, unit, portion,
            kcal, protein, fat, carb, salt, source
       FROM food_log
      WHERE date(eaten_at, 'localtime') = ?
      ORDER BY eaten_at DESC`,
    [date],
  )
  return rows ?? []
}

// 指定日の集計（摂取・運動消費・歩数・体重）。
//   energy / weight は採用行の source と image_uri も返す（UI のソースバッジ用）。
export const getDaySummary = async (date) => {
  const db = getDb()
  const intakeRow = await db.getFirstAsync(
    `SELECT COALESCE(SUM(kcal), 0) AS total
       FROM food_log
      WHERE date(eaten_at, 'localtime') = ?`,
    [date],
  )
  const energyRow = await db.getFirstAsync(
    `SELECT active_kcal, steps, source, image_uri
       FROM energy_log
      WHERE date(logged_at, 'localtime') = ?
      ORDER BY CASE source WHEN 'health' THEN 1 WHEN 'ocr' THEN 2 ELSE 3 END
      LIMIT 1`,
    [date],
  )
  const weightRow = await db.getFirstAsync(
    `SELECT weight_kg, measured_at, source, image_uri
       FROM weight_log
      WHERE date(measured_at, 'localtime') = ?
      ORDER BY measured_at DESC LIMIT 1`,
    [date],
  )
  return {
    intake: intakeRow?.total ?? 0,
    activeKcal: energyRow?.active_kcal ?? null,
    steps: energyRow?.steps ?? null,
    energySource: energyRow?.source ?? null,
    energyImageUri: energyRow?.image_uri ?? null,
    weightKg: weightRow?.weight_kg ?? null,
    weightSource: weightRow?.source ?? null,
    weightImageUri: weightRow?.image_uri ?? null,
  }
}

// 指定日の PFC を算出（home.js の getTodayMacros の date 指定版）。
export const getDayMacros = async (date) => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT
       COALESCE(SUM(fl.kcal), 0) AS totalKcal,
       COALESCE(SUM(CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                         THEN fl.kcal * f.protein_per_100g / f.kcal_per_100g END), 0) AS protein,
       COALESCE(SUM(CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                         THEN fl.kcal * f.fat_per_100g     / f.kcal_per_100g END), 0) AS fat,
       COALESCE(SUM(CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                         THEN fl.kcal * f.carb_per_100g    / f.kcal_per_100g END), 0) AS carb,
       COALESCE(SUM(CASE WHEN f.kcal_per_100g > 0 AND fl.kcal IS NOT NULL
                         THEN fl.kcal END), 0) AS matchedKcal
       FROM food_log fl
       LEFT JOIN foods f ON fl.ref_food_id = f.id AND fl.ref_kind = 'food'
      WHERE date(fl.eaten_at, 'localtime') = ?`,
    [date],
  )
  return {
    totalKcal: row?.totalKcal ?? 0,
    matchedKcal: row?.matchedKcal ?? 0,
    protein: row?.protein ?? 0,
    fat: row?.fat ?? 0,
    carb: row?.carb ?? 0,
  }
}

// 1件取得（編集画面用）。
export const getFoodLogItem = async (id) => {
  const db = getDb()
  return db.getFirstAsync(
    `SELECT * FROM food_log WHERE id = ?`,
    [id],
  )
}

// 編集. fields に含まれる列だけ UPDATE する（undefined はスキップ）。
// 許可する列を明示してSQLインジェクション/不正列を防ぐ。
const EDITABLE_COLS = ['eaten_at', 'name', 'quantity', 'unit', 'portion', 'kcal']

export const updateFoodLogItem = async (id, fields) => {
  const db = getDb()
  const sets = []
  const vals = []
  for (const col of EDITABLE_COLS) {
    if (fields[col] !== undefined) {
      sets.push(`${col} = ?`)
      vals.push(fields[col])
    }
  }
  if (sets.length === 0) return
  vals.push(id)
  await db.runAsync(`UPDATE food_log SET ${sets.join(', ')} WHERE id = ?`, vals)
}

export const deleteFoodLogItem = async (id) => {
  const db = getDb()
  await db.runAsync(`DELETE FROM food_log WHERE id = ?`, [id])
}
