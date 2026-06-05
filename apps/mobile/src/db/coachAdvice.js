import { getDb } from './index'

// 1 日 1 行のキャッシュ。同じ日の advice は上書き保存。
// snapshot_hash は coaching/advice.js 側で算出した文字列をそのまま入れる。

export const getCachedAdvice = async (date) => {
  const db = getDb()
  return db.getFirstAsync(
    `SELECT date, snapshot_hash, advice_text, model_id, generated_at
       FROM coach_advice
      WHERE date = ?`,
    [date],
  )
}

export const saveAdvice = async ({ date, snapshotHash, adviceText, modelId }) => {
  const db = getDb()
  await db.runAsync(
    `INSERT INTO coach_advice (date, snapshot_hash, advice_text, model_id, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       snapshot_hash = excluded.snapshot_hash,
       advice_text   = excluded.advice_text,
       model_id      = excluded.model_id,
       generated_at  = excluded.generated_at`,
    [date, snapshotHash, adviceText, modelId ?? null, new Date().toISOString()],
  )
}

export const deleteAdvice = async (date) => {
  const db = getDb()
  await db.runAsync(`DELETE FROM coach_advice WHERE date = ?`, [date])
}
