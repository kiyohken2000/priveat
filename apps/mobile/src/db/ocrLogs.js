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

// フィットネスアプリスクショの結果を energy_log に保存。
export const insertEnergyFromFitness = async (data, options = {}) => {
  const db = getDb()
  const loggedAt = new Date().toISOString()
  const { imageUri = null } = options
  const persisted = await persistOcrImage(imageUri, 'energy')
  const res = await db.runAsync(
    `INSERT INTO energy_log (logged_at, active_kcal, steps, source, image_uri)
     VALUES (?, ?, ?, 'ocr', ?)`,
    [loggedAt, data.activeKcal ?? null, data.steps ?? null, persisted],
  )
  return res?.lastInsertRowId ?? null
}

// 体重スクショの結果を weight_log に保存。
//   履歴複数行が読めても、現状は最新の1件だけを保存する。
export const insertWeightFromOcr = async (data, options = {}) => {
  const db = getDb()
  const measuredAt = new Date().toISOString()
  if (data.latest == null) return null
  const { imageUri = null } = options
  const persisted = await persistOcrImage(imageUri, 'weight')
  const res = await db.runAsync(
    `INSERT INTO weight_log (measured_at, weight_kg, source, image_uri)
     VALUES (?, ?, 'ocr', ?)`,
    [measuredAt, data.latest, persisted],
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
