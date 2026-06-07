import { getDb } from './index'

// energy_log は 1 日に複数行入る可能性があり、source ごとに「データの単位」が違う:
//   - 'health' : 1日の累計値 (HealthKit/Health Connect)。1日 1 行 UPSERT。
//   - 'ocr'    : フィットネスアプリ画面のスクショから読んだ 1日の累計値。
//   - 'text'   : ユーザーがチャットで入力した「単発の運動」(例: ランニング 30 分)。
//   - 'manual' : (現状未使用だが将来の手入力単発運動を想定)
//
// したがって「1 日 1 値」表示時は:
//   1. 最高優先 source を決定 (health > ocr > text > manual > その他)
//   2. その source の行を:
//        累計型 (health/ocr) なら 最新 1 件
//        単発型 (text/manual/その他) なら SUM
//   で集約する。
//
// 関連: docs/SPEC_アプリ仕様書.md "1日1値" 表示時の優先順位ルール

const PRIORITY = { health: 1, ocr: 2, text: 3, manual: 4 }
const priorityOf = (src) => PRIORITY[src] ?? 99

const CUMULATIVE_SOURCES = new Set(['health', 'ocr'])
export const isCumulativeSource = (src) => CUMULATIVE_SOURCES.has(src)

// 同日の同一 source 行配列を受け取り、累計型なら最新 1 件、単発型なら SUM して
// { active_kcal, basal_kcal, steps, source, image_uri } を返す。
const aggregateBySource = (rowsOfSameSource) => {
  if (!rowsOfSameSource || rowsOfSameSource.length === 0) return null
  const source = rowsOfSameSource[0].source
  if (isCumulativeSource(source)) {
    // logged_at 降順で並び替えて最新 1 件を採用 (HealthKit upsert は 1 行のみのはずだが、
    // 念のため複数あれば一番新しいものを採用)
    const sorted = [...rowsOfSameSource].sort((a, b) => {
      if (!a.logged_at) return 1
      if (!b.logged_at) return -1
      return a.logged_at < b.logged_at ? 1 : -1
    })
    const top = sorted[0]
    return {
      active_kcal: top.active_kcal ?? null,
      basal_kcal: top.basal_kcal ?? null,
      steps: top.steps ?? null,
      source,
      image_uri: top.image_uri ?? null,
    }
  }
  // 単発型: 全行の数値列を合算 (null は 0 扱い、すべて null なら null 維持)
  const sumOrNull = (key) => {
    let total = 0
    let hasAny = false
    for (const r of rowsOfSameSource) {
      if (r[key] != null) {
        total += r[key]
        hasAny = true
      }
    }
    return hasAny ? total : null
  }
  // image_uri は単発型では複数あり得るので、最新 1 件のものを返す (UI 用)
  const newest = [...rowsOfSameSource].sort((a, b) => {
    if (!a.logged_at) return 1
    if (!b.logged_at) return -1
    return a.logged_at < b.logged_at ? 1 : -1
  })[0]
  return {
    active_kcal: sumOrNull('active_kcal'),
    basal_kcal: sumOrNull('basal_kcal'),
    steps: sumOrNull('steps'),
    source,
    image_uri: newest?.image_uri ?? null,
  }
}

// 1 日の行配列 ({id, logged_at, active_kcal, basal_kcal, steps, source, image_uri}[]) を
// resolved 値に縮約する。該当日に行が無ければ null。
export const resolveDayRows = (rowsOfSingleDay) => {
  if (!rowsOfSingleDay || rowsOfSingleDay.length === 0) return null
  // 最高優先 source を決定 (source 単位での集約は別)
  const sources = new Set(rowsOfSingleDay.map((r) => r.source))
  let chosen = null
  let chosenPrio = Infinity
  for (const s of sources) {
    const p = priorityOf(s)
    if (p < chosenPrio) {
      chosen = s
      chosenPrio = p
    }
  }
  if (chosen == null) return null
  const rowsOfChosen = rowsOfSingleDay.filter((r) => r.source === chosen)
  return aggregateBySource(rowsOfChosen)
}

// 指定日 'YYYY-MM-DD' の resolved 値を返す。
//   戻り値: { active_kcal, basal_kcal, steps, source, image_uri } | null
export const resolveDailyEnergy = async (date) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, logged_at, active_kcal, basal_kcal, steps, source, image_uri
       FROM energy_log
      WHERE date(logged_at, 'localtime') = ?`,
    [date],
  )
  return resolveDayRows(rows ?? [])
}

// 期間 [startDate, endDate] (両端含む) の日ごとの resolved 値を返す。
//   戻り値: Map<'YYYY-MM-DD', { active_kcal, basal_kcal, steps, source, image_uri }>
//   行が無い日はキー自体含まれない。
export const resolveDailyEnergyRange = async (startDate, endDate) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, logged_at, active_kcal, basal_kcal, steps, source, image_uri,
            date(logged_at, 'localtime') AS day
       FROM energy_log
      WHERE date(logged_at, 'localtime') BETWEEN ? AND ?`,
    [startDate, endDate],
  )
  const byDate = new Map()
  for (const r of rows ?? []) {
    if (!byDate.has(r.day)) byDate.set(r.day, [])
    byDate.get(r.day).push(r)
  }
  const result = new Map()
  for (const [day, dayRows] of byDate) {
    const resolved = resolveDayRows(dayRows)
    if (resolved) result.set(day, resolved)
  }
  return result
}
