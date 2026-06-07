import { getDb } from './index'
import { deletePersistedImage } from '../utils/persistImage'

// weight_log の個別行 CRUD。1日の内訳表示・編集・削除に使う。
//
// source ごとの編集ポリシー (UI 側で制御):
//   - 'text' / 'manual' : 全フィールド編集可
//   - 'ocr'             : 削除のみ可 (元画像との乖離を避ける)
//   - 'health'          : 閲覧のみ (HealthKit/Health Connect 同期で上書きされる)

export const getWeightLogByDate = async (date) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, measured_at, weight_kg, source, image_uri
       FROM weight_log
      WHERE date(measured_at, 'localtime') = ?
      ORDER BY measured_at DESC`,
    [date],
  )
  return rows ?? []
}

export const getWeightLogItem = async (id) => {
  const db = getDb()
  return db.getFirstAsync(
    `SELECT id, measured_at, weight_kg, source, image_uri
       FROM weight_log
      WHERE id = ?`,
    [id],
  )
}

const EDITABLE_COLS = ['measured_at', 'weight_kg']

export const updateWeightLogItem = async (id, fields) => {
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
  await db.runAsync(`UPDATE weight_log SET ${sets.join(', ')} WHERE id = ?`, vals)
}

export const deleteWeightLogItem = async (id) => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT image_uri FROM weight_log WHERE id = ?`,
    [id],
  )
  await db.runAsync(`DELETE FROM weight_log WHERE id = ?`, [id])
  if (row?.image_uri) {
    await deletePersistedImage(row.image_uri)
  }
}
