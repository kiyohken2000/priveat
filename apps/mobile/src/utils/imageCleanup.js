import { getDb } from '../db'
import { deletePersistedImage, resolveOcrImageUri } from './persistImage'

// 一定日数以上前の OCR 画像をディスクから削除し、DB の image_uri を NULL に更新する。
//   - 対象テーブル: weight_log / energy_log / products
//   - 比較する日付列はテーブルごとに異なる（下の TARGETS 参照）
//   - DB 行自体は残す（履歴の数値は捨てたくないため、画像だけ消す）
//   - ファイル削除に失敗しても DB は更新する（孤児ファイルがあっても次回再試行はしない）
//   - エラーは飲み込む（fire-and-forget で起動時に呼ぶ想定なので、起動を妨げない）

const TARGETS = [
  { table: 'weight_log', dateCol: 'measured_at' },
  { table: 'energy_log', dateCol: 'logged_at' },
  { table: 'products',   dateCol: 'created_at' },
]

export const cleanupOldOcrImages = async ({ maxAgeDays = 50 } = {}) => {
  let db
  try {
    db = getDb()
  } catch (e) {
    // DB 未初期化 → 何もしない
    return { deleted: 0, errors: 0 }
  }

  let deleted = 0
  let errors = 0

  for (const { table, dateCol } of TARGETS) {
    try {
      const rows = await db.getAllAsync(
        `SELECT id, image_uri FROM ${table}
          WHERE image_uri IS NOT NULL
            AND date(${dateCol}, 'localtime') < date('now', 'localtime', ?)`,
        [`-${maxAgeDays} days`],
      )
      for (const row of rows ?? []) {
        await deletePersistedImage(resolveOcrImageUri(row.image_uri))
        try {
          await db.runAsync(
            `UPDATE ${table} SET image_uri = NULL WHERE id = ?`,
            [row.id],
          )
          deleted += 1
        } catch (e) {
          errors += 1
          console.warn(`[imageCleanup] update failed ${table}#${row.id}:`, e?.message ?? e)
        }
      }
    } catch (e) {
      errors += 1
      console.warn(`[imageCleanup] scan failed ${table}:`, e?.message ?? e)
    }
  }

  if (deleted > 0 || errors > 0) {
    console.log(`[imageCleanup] purged ${deleted} images (errors: ${errors}, ttl: ${maxAgeDays}d)`)
  }
  return { deleted, errors }
}
