import { getDb } from './index'
import { resolveDailyEnergyRange } from './energyResolve'

// 'YYYY-MM-DD' を n 日前後にずらす ('-7 days' のような SQLite 修飾子はクライアントでは
// 直接使えないので、JS Date でずらして整形)
const shiftDateStr = (dateStr, days) => {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const todayLocalDateStr = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

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
  const today = todayLocalDateStr()
  const startDate = shiftDateStr(today, -daysBack)
  // 摂取（food_log を日別合計）
  const [intakeRows, energyByDate] = await Promise.all([
    db.getAllAsync(
      `SELECT date(eaten_at, 'localtime') AS date,
              COALESCE(SUM(kcal), 0) AS intake
         FROM food_log
        WHERE date(eaten_at, 'localtime') >= ?
        GROUP BY date
        ORDER BY date ASC`,
      [startDate],
    ),
    // 運動消費は energy_log を resolve (source 別戦略: health/ocr=最新1件, text/manual=SUM)
    resolveDailyEnergyRange(startDate, today),
  ])

  // date キーで結合（intake または active のどちらかがある日だけ含める）
  const byDate = new Map()
  for (const r of intakeRows) byDate.set(r.date, { date: r.date, intake: r.intake ?? 0, active: null })
  for (const [date, energy] of energyByDate) {
    const existing = byDate.get(date)
    if (existing) existing.active = energy.active_kcal ?? null
    else byDate.set(date, { date, intake: 0, active: energy.active_kcal ?? null })
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// 日別リスト用: 過去 daysBack 日分、各日のサマリ。
// 戻り値: [{ date, intake, active, weight }] 新しい順
export const getDailyHistory = async ({ daysBack = 30 } = {}) => {
  const db = getDb()
  const today = todayLocalDateStr()
  const startDate = shiftDateStr(today, -(daysBack - 1))
  // intake / weight は SQL 側で完結、active のみ resolve ヘルパで計算してマージ
  const [rows, energyByDate] = await Promise.all([
    db.getAllAsync(
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
         (SELECT weight_kg FROM weight_log
           WHERE date(measured_at, 'localtime') = days.date
           ORDER BY measured_at DESC LIMIT 1) AS weight
       FROM days
       ORDER BY days.date DESC`,
      [daysBack],
    ),
    resolveDailyEnergyRange(startDate, today),
  ])
  return (rows ?? []).map((r) => ({
    ...r,
    active: energyByDate.get(r.date)?.active_kcal ?? null,
  }))
}
