import { getDb } from './index'

// 食品ラベル OCR の結果を products に保存。
//   name は ID 化のため日時を含める（後で history から識別できるように）。
export const insertProductFromLabel = async (data, options = {}) => {
  const db = getDb()
  const createdAt = new Date().toISOString()
  const fallbackName = `ラベル読取 ${new Date().toLocaleString('ja-JP')}`
  const { name = fallbackName } = options
  const res = await db.runAsync(
    `INSERT INTO products (name, kcal, protein, fat, carb, salt, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'label_ocr', ?)`,
    [
      name,
      data.kcal ?? null,
      data.protein ?? null,
      data.fat ?? null,
      data.carb ?? null,
      data.salt ?? null,
      createdAt,
    ],
  )
  return res?.lastInsertRowId ?? null
}

// フィットネスアプリスクショの結果を energy_log に保存。
export const insertEnergyFromFitness = async (data) => {
  const db = getDb()
  const loggedAt = new Date().toISOString()
  const res = await db.runAsync(
    `INSERT INTO energy_log (logged_at, active_kcal, steps, source)
     VALUES (?, ?, ?, 'ocr')`,
    [loggedAt, data.activeKcal ?? null, data.steps ?? null],
  )
  return res?.lastInsertRowId ?? null
}

// 体重スクショの結果を weight_log に保存。
//   履歴複数行が読めても、現状は最新の1件だけを保存する。
export const insertWeightFromOcr = async (data) => {
  const db = getDb()
  const measuredAt = new Date().toISOString()
  if (data.latest == null) return null
  const res = await db.runAsync(
    `INSERT INTO weight_log (measured_at, weight_kg, source)
     VALUES (?, ?, 'ocr')`,
    [measuredAt, data.latest],
  )
  return res?.lastInsertRowId ?? null
}
