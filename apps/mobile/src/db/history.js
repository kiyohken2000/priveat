import { getDb } from './index'

// 過去 daysBack 日分の体重時系列。1日1値（その日の最新測定値）。
// 戻り値: [{ date: 'YYYY-MM-DD', weight_kg: number }] 古い順
export const getWeightSeries = async ({ daysBack = 30 } = {}) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT date(measured_at, 'localtime') AS date,
            weight_kg
       FROM weight_log
      WHERE date(measured_at, 'localtime') >= date('now', 'localtime', ?)
        AND id IN (
          SELECT id FROM weight_log w2
          WHERE date(w2.measured_at, 'localtime') = date(weight_log.measured_at, 'localtime')
          ORDER BY w2.measured_at DESC
          LIMIT 1
        )
      ORDER BY date ASC`,
    [`-${daysBack} days`],
  )
  return rows ?? []
}

// 過去 daysBack 日分の日別カロリー（摂取・運動消費）。
// 戻り値: [{ date: 'YYYY-MM-DD', intake: number, active: number|null }] 古い順
export const getCalorieSeries = async ({ daysBack = 14 } = {}) => {
  const db = getDb()
  // 摂取（food_log を日別合計）
  const intakeRows = await db.getAllAsync(
    `SELECT date(eaten_at, 'localtime') AS date,
            COALESCE(SUM(kcal), 0) AS intake
       FROM food_log
      WHERE date(eaten_at, 'localtime') >= date('now', 'localtime', ?)
      GROUP BY date
      ORDER BY date ASC`,
    [`-${daysBack} days`],
  )
  // 運動消費（energy_log を日別、health > ocr 優先1件）
  const activeRows = await db.getAllAsync(
    `SELECT date(logged_at, 'localtime') AS date,
            active_kcal AS active
       FROM energy_log e
      WHERE date(logged_at, 'localtime') >= date('now', 'localtime', ?)
        AND e.id = (
          SELECT id FROM energy_log e2
          WHERE date(e2.logged_at, 'localtime') = date(e.logged_at, 'localtime')
          ORDER BY
            CASE e2.source
              WHEN 'health' THEN 1
              WHEN 'ocr' THEN 2
              ELSE 3
            END
          LIMIT 1
        )
      ORDER BY date ASC`,
    [`-${daysBack} days`],
  )

  // date キーで結合（intake または active のどちらかがある日だけ含める）
  const byDate = new Map()
  for (const r of intakeRows) byDate.set(r.date, { date: r.date, intake: r.intake ?? 0, active: null })
  for (const r of activeRows) {
    const existing = byDate.get(r.date)
    if (existing) existing.active = r.active ?? null
    else byDate.set(r.date, { date: r.date, intake: 0, active: r.active ?? null })
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// 日別リスト用: 過去 daysBack 日分、各日のサマリ。
// 戻り値: [{ date, intake, active, weight }] 新しい順
export const getDailyHistory = async ({ daysBack = 30 } = {}) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `WITH days AS (
       SELECT date('now', 'localtime', '-' || (n - 1) || ' days') AS date
       FROM (
         WITH RECURSIVE seq(n) AS (
           SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
         ) SELECT n FROM seq
       )
     )
     SELECT days.date AS date,
       (SELECT COALESCE(SUM(kcal), 0)
          FROM food_log
         WHERE date(eaten_at, 'localtime') = days.date) AS intake,
       (SELECT active_kcal FROM energy_log e
         WHERE date(logged_at, 'localtime') = days.date
         ORDER BY CASE source WHEN 'health' THEN 1 WHEN 'ocr' THEN 2 ELSE 3 END
         LIMIT 1) AS active,
       (SELECT weight_kg FROM weight_log
         WHERE date(measured_at, 'localtime') = days.date
         ORDER BY measured_at DESC LIMIT 1) AS weight
     FROM days
     ORDER BY days.date DESC`,
    [daysBack],
  )
  return rows ?? []
}
