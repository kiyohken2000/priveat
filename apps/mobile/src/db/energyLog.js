import { getDb } from './index'
import { deletePersistedImage, resolveOcrImageUri } from '../utils/persistImage'

// energy_log の個別行 CRUD。1日の内訳表示・編集・削除に使う。
//
// source ごとの編集ポリシー (UI 側で制御):
//   - 'text' / 'manual' : 全フィールド編集可
//   - 'ocr'             : 削除のみ可 (元画像と数値が乖離しないように編集は不可)
//   - 'health'          : 閲覧のみ (HealthKit/Health Connect 同期で上書きされるため)

// 指定日 'YYYY-MM-DD' の energy_log 行を返す。
// 並び順: ヘルスケア (health, 1日累計) を先頭に、その後は時刻降順 (新しい単発入力が上)。
export const getEnergyLogByDate = async (date) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, logged_at, active_kcal, basal_kcal, steps,
            activity_name, duration_min, source, image_uri
       FROM energy_log
      WHERE date(logged_at, 'localtime') = ?
      ORDER BY CASE source WHEN 'health' THEN 0 ELSE 1 END,
               logged_at DESC`,
    [date],
  )
  return rows ?? []
}

export const getEnergyLogItem = async (id) => {
  const db = getDb()
  return db.getFirstAsync(
    `SELECT id, logged_at, active_kcal, basal_kcal, steps,
            activity_name, duration_min, source, image_uri
       FROM energy_log
      WHERE id = ?`,
    [id],
  )
}

// 編集可能列のみ列挙 (列名は SQL に直接埋め込むのでホワイトリスト必須)
const EDITABLE_COLS = ['logged_at', 'active_kcal', 'steps', 'activity_name', 'duration_min']

export const updateEnergyLogItem = async (id, fields) => {
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
  await db.runAsync(`UPDATE energy_log SET ${sets.join(', ')} WHERE id = ?`, vals)
}

// 削除。image_uri があれば一緒に物理削除する (孤児ファイル防止)。
export const deleteEnergyLogItem = async (id) => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT image_uri FROM energy_log WHERE id = ?`,
    [id],
  )
  await db.runAsync(`DELETE FROM energy_log WHERE id = ?`, [id])
  if (row?.image_uri) {
    await deletePersistedImage(resolveOcrImageUri(row.image_uri))
  }
}
