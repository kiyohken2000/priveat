import { getDb } from './index'

// 週次サマリーへのアドバイスキャッシュ。week_start (YYYY-MM-DD) が PK。
// 日次の coachAdvice と同じ責務分担: snapshot_hash は coaching/advice.js 側で算出する。

export const getCachedWeeklyAdvice = async (weekStart) => {
  const db = getDb()
  return db.getFirstAsync(
    `SELECT week_start, snapshot_hash, advice_text, model_id, generated_at
       FROM coach_weekly_advice
      WHERE week_start = ?`,
    [weekStart],
  )
}

export const saveWeeklyAdvice = async ({ weekStart, snapshotHash, adviceText, modelId }) => {
  const db = getDb()
  await db.runAsync(
    `INSERT INTO coach_weekly_advice (week_start, snapshot_hash, advice_text, model_id, generated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET
       snapshot_hash = excluded.snapshot_hash,
       advice_text   = excluded.advice_text,
       model_id      = excluded.model_id,
       generated_at  = excluded.generated_at`,
    [weekStart, snapshotHash, adviceText, modelId ?? null, new Date().toISOString()],
  )
}

export const deleteWeeklyAdvice = async (weekStart) => {
  const db = getDb()
  await db.runAsync(`DELETE FROM coach_weekly_advice WHERE week_start = ?`, [weekStart])
}
