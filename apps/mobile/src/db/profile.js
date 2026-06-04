import { getDb } from './index'

// profile テーブルは id=1 の単一行で運用（ユーザーは1人）。
// 体重は時系列（weight_log）なので profile には保持しない。
// 表示時は最新の weight_log を「現在の体重」とみなす。

export const getProfile = async () => {
  const db = getDb()
  const row = await db.getFirstAsync('SELECT * FROM profile WHERE id = 1')
  return row ?? null
}

// weight_log から最新1件を取って weight_kg と measured_at を返す。
export const getLatestWeight = async () => {
  const db = getDb()
  const row = await db.getFirstAsync(
    'SELECT weight_kg, measured_at FROM weight_log ORDER BY measured_at DESC LIMIT 1',
  )
  return row ?? null
}

// プロフィールと（指定があれば）体重を一括で保存。
//   - profile (id=1) を INSERT OR REPLACE
//   - newWeightKg が数値なら weight_log に APPEND（source='manual'）
//     既存最新値と同じなら APPEND しない（連打で増えないように）
export const saveProfile = async ({
  age = null,
  sex = null,
  heightCm = null,
  targetWeightKg = null,
  dailyKcalTarget = null,
  newWeightKg = null,
}) => {
  const db = getDb()

  await db.runAsync(
    `INSERT OR REPLACE INTO profile
       (id, height_cm, age, sex, target_weight_kg, daily_kcal_target)
     VALUES (1, ?, ?, ?, ?, ?)`,
    [heightCm, age, sex, targetWeightKg, dailyKcalTarget],
  )

  let appendedWeightId = null
  if (newWeightKg != null && !Number.isNaN(newWeightKg)) {
    const latest = await getLatestWeight()
    const shouldAppend = !latest || Math.abs(latest.weight_kg - newWeightKg) > 1e-6
    if (shouldAppend) {
      const measuredAt = new Date().toISOString()
      const res = await db.runAsync(
        `INSERT INTO weight_log (measured_at, weight_kg, source)
         VALUES (?, ?, 'manual')`,
        [measuredAt, newWeightKg],
      )
      appendedWeightId = res?.lastInsertRowId ?? null
    }
  }

  return { appendedWeightId }
}
