import { getDb } from '../db'
import { resolveDailyEnergy, resolveDailyEnergyRange } from '../db/energyResolve'
import { getLatestWeight, getProfile } from '../db/profile'
import { computeBmr } from '../utils/bmr'
import { getStance } from './stance'

// 日付 'YYYY-MM-DD'（ローカル）
const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const round = (n) => (n == null ? null : Math.round(n))

// 過去7日の平均（摂取・運動消費）。データ無しの日は除外。
const get7dAverages = async (db) => {
  const intakeRow = await db.getFirstAsync(
    `SELECT AVG(daily) AS avg FROM (
       SELECT date(eaten_at,'localtime') AS d, SUM(kcal) AS daily
         FROM food_log
        WHERE date(eaten_at,'localtime') >= date('now','localtime','-7 days')
        GROUP BY d
     )`,
  )
  // energy は source 別戦略で resolve してから平均を取る
  const todayRow = await db.getFirstAsync(
    `SELECT date('now','localtime') AS today, date('now','localtime','-7 days') AS start`,
  )
  const energyByDate = await resolveDailyEnergyRange(todayRow.start, todayRow.today)
  const actives = [...energyByDate.values()]
    .map((e) => e.active_kcal)
    .filter((v) => v != null)
  const avgActive = actives.length > 0
    ? actives.reduce((a, b) => a + b, 0) / actives.length
    : null
  return {
    avgIntake: intakeRow?.avg ?? null,
    avgActive,
  }
}

// 今日の値
const getTodayValues = async (db) => {
  const today = dayKey(new Date())
  const [intakeRow, energy] = await Promise.all([
    db.getFirstAsync(
      `SELECT COALESCE(SUM(kcal),0) AS total FROM food_log
        WHERE date(eaten_at,'localtime') = ?`,
      [today],
    ),
    resolveDailyEnergy(today),
  ])
  return {
    intake: intakeRow?.total ?? 0,
    activeKcal: energy?.active_kcal ?? null,
    steps: energy?.steps ?? null,
  }
}

// 体重トレンド（最新と約1週間前の差分）
const getWeightTrend = async (db) => {
  const latest = await db.getFirstAsync(
    `SELECT weight_kg, measured_at FROM weight_log
      ORDER BY measured_at DESC LIMIT 1`,
  )
  if (!latest) return { latest: null, weekAgo: null, delta: null }
  // 7±3 日前の体重を探す
  const past = await db.getFirstAsync(
    `SELECT weight_kg, measured_at FROM weight_log
      WHERE date(measured_at,'localtime') BETWEEN
            date(?, '-10 days') AND date(?, '-4 days')
      ORDER BY measured_at DESC LIMIT 1`,
    [dayKey(new Date(latest.measured_at)), dayKey(new Date(latest.measured_at))],
  )
  return {
    latest,
    weekAgo: past ?? null,
    delta: past ? latest.weight_kg - past.weight_kg : null,
  }
}

const sexLabel = (s) => (s === 'male' ? '男性' : s === 'female' ? '女性' : '未設定')

// LLM に渡すコンテキスト文字列を組み立て。
//   - 数値は丸めて短く
//   - データ無い部分は省く（行ごと省略 or 「未設定」）
export const buildCoachingContext = async () => {
  const db = getDb()
  const [profile, latestWeight, today, avg, trend, stance] = await Promise.all([
    getProfile(),
    getLatestWeight(),
    getTodayValues(db),
    get7dAverages(db),
    getWeightTrend(db),
    getStance(),
  ])

  const bmr = computeBmr({
    weightKg: latestWeight?.weight_kg,
    heightCm: profile?.height_cm,
    age: profile?.age,
    sex: profile?.sex,
  })

  const today4 = (() => {
    const d = new Date()
    const days = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`
  })()

  const lines = []

  // ユーザー自身が書いた指示・スタンス（自由文）。LLM はこれを最優先で考慮する想定。
  if (stance && stance.trim().length > 0) {
    lines.push('【ユーザーからの指示】')
    lines.push(stance.trim())
    lines.push('')
  }

  // プロフィール
  lines.push('【ユーザー情報】')
  if (profile) {
    const parts = []
    if (profile.sex) parts.push(`性別:${sexLabel(profile.sex)}`)
    if (profile.age != null) parts.push(`年齢:${profile.age}歳`)
    if (profile.height_cm != null) parts.push(`身長:${profile.height_cm}cm`)
    if (latestWeight) parts.push(`体重:${latestWeight.weight_kg}kg`)
    if (parts.length) lines.push('- ' + parts.join(' / '))
    if (profile.target_weight_kg != null) lines.push(`- 目標体重: ${profile.target_weight_kg}kg`)
    if (profile.daily_kcal_target != null) {
      lines.push(`- 1日カロリー目標: ${profile.daily_kcal_target}kcal`)
    }
  } else {
    lines.push('- 未設定')
  }
  lines.push('')

  // 今日
  lines.push(`【今日 (${today4})】`)
  lines.push(`- 摂取: ${round(today.intake)}kcal`)
  if (today.activeKcal != null) {
    const stepStr = today.steps != null ? ` (${today.steps.toLocaleString()}歩)` : ''
    lines.push(`- 運動消費: ${round(today.activeKcal)}kcal${stepStr}`)
  }
  if (bmr != null) lines.push(`- 基礎代謝: ${round(bmr)}kcal`)
  const totalBurn = (today.activeKcal ?? 0) + (bmr ?? 0)
  if (totalBurn > 0) {
    const net = today.intake - totalBurn
    const sign = net > 0 ? '+' : ''
    lines.push(`- 差分: ${sign}${round(net)}kcal (${net < 0 ? '赤字=不足' : '黒字=超過'})`)
  }
  lines.push('')

  // 過去7日平均
  if (avg.avgIntake != null || avg.avgActive != null) {
    lines.push('【過去7日平均】')
    if (avg.avgIntake != null) lines.push(`- 摂取: ${round(avg.avgIntake)}kcal/日`)
    if (avg.avgActive != null) lines.push(`- 運動消費: ${round(avg.avgActive)}kcal/日`)
    lines.push('')
  }

  // 体重トレンド
  if (trend.latest) {
    lines.push('【体重】')
    lines.push(`- 最新: ${trend.latest.weight_kg}kg`)
    if (trend.delta != null) {
      const sign = trend.delta > 0 ? '+' : ''
      lines.push(`- 約1週間前との差: ${sign}${trend.delta.toFixed(1)}kg`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}
