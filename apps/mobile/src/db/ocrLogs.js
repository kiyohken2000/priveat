import { getDb } from './index'
import { deletePersistedImage, persistOcrImage } from '../utils/persistImage'

// 食品ラベル OCR の結果を products に保存。
//   name は ID 化のため日時を含める（後で history から識別できるように）。
//   imageUri が渡された場合は documentDirectory にコピーして products.image_uri に保存。
export const insertProductFromLabel = async (data, options = {}) => {
  const db = getDb()
  const createdAt = new Date().toISOString()
  const fallbackName = `ラベル読取 ${new Date().toLocaleString('ja-JP')}`
  const { name = fallbackName, imageUri = null } = options
  const persisted = await persistOcrImage(imageUri, 'label')
  const res = await db.runAsync(
    `INSERT INTO products (name, kcal, protein, fat, carb, salt, source, image_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'label_ocr', ?, ?)`,
    [
      name,
      data.kcal ?? null,
      data.protein ?? null,
      data.fat ?? null,
      data.carb ?? null,
      data.salt ?? null,
      persisted,
      createdAt,
    ],
  )
  return res?.lastInsertRowId ?? null
}

// 活動量を energy_log に1行入れる統一ヘルパー。テキスト・OCR どちらの経路からも呼ぶ。
//   source: 'text' | 'ocr' (将来 'health' / 'manual' も追加余地)
//   activity_name / duration_min: テキスト経路で使う種目別の記録。OCR (フィットネス全体集計) では null
//   active_kcal / basal_kcal / steps: 値があれば保存、無ければ null
//   imageUri: 原本 URI。渡されれば documentDirectory にコピーして image_uri に保存。
export const insertEnergyLog = async ({
  active_kcal = null,
  basal_kcal = null,
  steps = null,
  activity_name = null,
  duration_min = null,
  source,
  imageUri = null,
}) => {
  const db = getDb()
  const loggedAt = new Date().toISOString()
  const persisted = imageUri ? await persistOcrImage(imageUri, 'energy') : null
  const res = await db.runAsync(
    `INSERT INTO energy_log
       (logged_at, active_kcal, basal_kcal, steps, activity_name, duration_min, source, image_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [loggedAt, active_kcal, basal_kcal, steps, activity_name, duration_min, source, persisted],
  )
  return res?.lastInsertRowId ?? null
}

// フィットネスアプリスクショの結果を energy_log に保存（薄いラッパ）。
export const insertEnergyFromFitness = async (data, options = {}) => {
  return insertEnergyLog({
    active_kcal: data.activeKcal ?? null,
    steps: data.steps ?? null,
    source: 'ocr',
    imageUri: options.imageUri ?? null,
  })
}

// 体重を weight_log に1行入れる統一ヘルパー。テキスト経路・OCR 経路の両方から呼ぶ。
//   source: 'text' | 'ocr' (今後 'health' / 'manual' 追加余地あり)
//   imageUri: 原本 URI (カメラ/ライブラリ)。渡された場合は documentDirectory にコピーして保存。
export const insertWeightLog = async ({ weight_kg, source, imageUri = null }) => {
  if (weight_kg == null) return null
  const db = getDb()
  const measuredAt = new Date().toISOString()
  const persisted = imageUri ? await persistOcrImage(imageUri, 'weight') : null
  const res = await db.runAsync(
    `INSERT INTO weight_log (measured_at, weight_kg, source, image_uri)
     VALUES (?, ?, ?, ?)`,
    [measuredAt, weight_kg, source, persisted],
  )
  return res?.lastInsertRowId ?? null
}

// ---- 行削除ヘルパー ---------------------------------------------------------
// 各テーブル行を削除する際、紐づく image_uri のファイルも削除する。
// 将来、weight_log / energy_log / products の削除 UI を実装したらここを呼ぶこと。
// ファイル削除失敗は致命ではないため握りつぶす（孤児ファイルは TTL で消える）。

const deleteRowWithImage = async (table, id) => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT image_uri FROM ${table} WHERE id = ?`,
    [id],
  )
  if (row?.image_uri) {
    await deletePersistedImage(row.image_uri)
  }
  await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id])
}

export const deleteWeightLogRow = (id) => deleteRowWithImage('weight_log', id)
export const deleteEnergyLogRow = (id) => deleteRowWithImage('energy_log', id)
export const deleteProductRow   = (id) => deleteRowWithImage('products',   id)
