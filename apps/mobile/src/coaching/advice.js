import { getDb } from '../db'
import { getCachedAdvice, saveAdvice } from '../db/coachAdvice'
import { getProfile, getLatestWeight } from '../db/profile'
import { computeBmr } from '../utils/bmr'
import { getStance } from './stance'

// 1 日サマリーに対するコーチからの短いアドバイス。
//   - 取得手順: getOrGenerateAdvice({ date, llm, force })
//   - キャッシュは coach_advice テーブル (1 日 1 行)。snapshot_hash で stale 判定。
//   - LLM 呼び出しは llm.generate(messages) のワンショット。Chat の messageHistory を汚さない。

const round = (n) => (n == null ? null : Math.round(n))

const sexLabel = (s) => (s === 'male' ? '男性' : s === 'female' ? '女性' : '未設定')

const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

const todayKey = () => dayKey(new Date())

const formatDateLabel = (dateStr) => {
  // 'YYYY-MM-DD' → 'M/D(曜)'
  const d = new Date(`${dateStr}T00:00:00`)
  const days = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`
}

// ---- データ取得 (date 指定) ------------------------------------------------

const getDayValues = async (db, date) => {
  const intakeRow = await db.getFirstAsync(
    `SELECT COALESCE(SUM(kcal), 0) AS total
       FROM food_log
      WHERE date(eaten_at, 'localtime') = ?`,
    [date],
  )
  const energyRow = await db.getFirstAsync(
    `SELECT active_kcal, steps
       FROM energy_log
      WHERE date(logged_at, 'localtime') = ?
      ORDER BY CASE source WHEN 'health' THEN 1 WHEN 'ocr' THEN 2 ELSE 3 END
      LIMIT 1`,
    [date],
  )
  return {
    intake: intakeRow?.total ?? 0,
    activeKcal: energyRow?.active_kcal ?? null,
    steps: energyRow?.steps ?? null,
  }
}

// 該当日を末尾とする 7 日間の平均 (摂取・運動消費)。データ無い日は除外。
const get7dAveragesUntil = async (db, date) => {
  const intakeRow = await db.getFirstAsync(
    `SELECT AVG(daily) AS avg FROM (
       SELECT date(eaten_at,'localtime') AS d, SUM(kcal) AS daily
         FROM food_log
        WHERE date(eaten_at,'localtime') BETWEEN date(?, '-6 days') AND ?
        GROUP BY d
     )`,
    [date, date],
  )
  const activeRow = await db.getFirstAsync(
    `SELECT AVG(active_kcal) AS avg FROM (
       SELECT date(logged_at,'localtime') AS d, active_kcal
         FROM energy_log e
        WHERE date(logged_at,'localtime') BETWEEN date(?, '-6 days') AND ?
          AND e.id = (
            SELECT id FROM energy_log e2
            WHERE date(e2.logged_at,'localtime') = date(e.logged_at,'localtime')
            ORDER BY CASE source WHEN 'health' THEN 1 WHEN 'ocr' THEN 2 ELSE 3 END
            LIMIT 1
          )
     )`,
    [date, date],
  )
  return {
    avgIntake: intakeRow?.avg ?? null,
    avgActive: activeRow?.avg ?? null,
  }
}

// 該当日かそれ以前で最も近い体重 + 約 1 週間前の体重 (4〜10 日前) の差。
const getWeightAround = async (db, date) => {
  const recent = await db.getFirstAsync(
    `SELECT weight_kg, measured_at FROM weight_log
      WHERE date(measured_at,'localtime') <= ?
      ORDER BY measured_at DESC LIMIT 1`,
    [date],
  )
  if (!recent) return { recent: null, weekAgo: null, delta: null }
  const past = await db.getFirstAsync(
    `SELECT weight_kg, measured_at FROM weight_log
      WHERE date(measured_at,'localtime') BETWEEN
            date(?, '-10 days') AND date(?, '-4 days')
      ORDER BY measured_at DESC LIMIT 1`,
    [date, date],
  )
  return {
    recent,
    weekAgo: past ?? null,
    delta: past ? recent.weight_kg - past.weight_kg : null,
  }
}

// ---- コンテキスト組み立て -------------------------------------------------

export const buildAdviceContextForDate = async (date) => {
  const db = getDb()
  const isToday = date === todayKey()
  const [profile, latestWeight, day, avg, weight, stance] = await Promise.all([
    getProfile(),
    getLatestWeight(),
    getDayValues(db, date),
    get7dAveragesUntil(db, date),
    getWeightAround(db, date),
    getStance(),
  ])

  // BMR は最新体重とプロフィールから算出 (該当日時点の体重ではない近似)。
  const bmr = computeBmr({
    weightKg: latestWeight?.weight_kg,
    heightCm: profile?.height_cm,
    age: profile?.age,
    sex: profile?.sex,
  })

  const lines = []

  if (stance && stance.trim().length > 0) {
    lines.push('【ユーザーからの指示】')
    lines.push(stance.trim())
    lines.push('')
  }

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

  lines.push(`【${isToday ? '今日' : 'この日'} (${formatDateLabel(date)})】`)
  lines.push(`- 摂取: ${round(day.intake)}kcal`)
  if (day.activeKcal != null) {
    const stepStr = day.steps != null ? ` (${day.steps.toLocaleString()}歩)` : ''
    lines.push(`- 運動消費: ${round(day.activeKcal)}kcal${stepStr}`)
  }
  if (bmr != null) lines.push(`- 基礎代謝: ${round(bmr)}kcal`)
  const totalBurn = (day.activeKcal ?? 0) + (bmr ?? 0)
  if (totalBurn > 0) {
    const net = day.intake - totalBurn
    const sign = net > 0 ? '+' : ''
    lines.push(`- 差分: ${sign}${round(net)}kcal (${net < 0 ? '赤字=不足' : '黒字=超過'})`)
  }
  lines.push('')

  if (avg.avgIntake != null || avg.avgActive != null) {
    lines.push(`【この日までの 7 日平均】`)
    if (avg.avgIntake != null) lines.push(`- 摂取: ${round(avg.avgIntake)}kcal/日`)
    if (avg.avgActive != null) lines.push(`- 運動消費: ${round(avg.avgActive)}kcal/日`)
    lines.push('')
  }

  if (weight.recent) {
    lines.push('【体重】')
    lines.push(`- ${formatDateLabel(dayKey(new Date(weight.recent.measured_at)))}時点: ${weight.recent.weight_kg}kg`)
    if (weight.delta != null) {
      const sign = weight.delta > 0 ? '+' : ''
      lines.push(`- 約1週間前との差: ${sign}${weight.delta.toFixed(1)}kg`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

// ---- スナップショットハッシュ ---------------------------------------------

// FNV-1a (32bit) を 16 進文字列で返す。短くて衝突が低く crypto 依存無し。
const fnv1a = (str) => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// 入力 (context + modelId) が同じなら同じハッシュ → キャッシュ有効。
export const computeSnapshotHash = ({ context, modelId }) => {
  return fnv1a(`${modelId ?? ''}::${context}`)
}

// ---- プロンプト ------------------------------------------------------------

const COACH_ADVICE_SYSTEM_PROMPT = `あなたは食事と健康のコーチです。以下のルールで日本語で答えてください。

ルール:
- ユーザーデータに基づいて答える（推測しない）
- 否定的な言い方を避け、前向きで励ますトーン
- 200〜400 文字程度で簡潔に。冗長な前置きは不要
- マークダウンの軽い装飾 (見出し##、強調**、箇条書き- ) を使ってよい
- 改善案を提案する場合は 1 つに絞る
- 医療的な判断はしない（必要に応じて「医師に相談」を促すのは可）
- /no_think`

const buildAdviceMessages = (context, kind) => {
  const ask =
    kind === 'past'
      ? 'この日の記録を踏まえて、振り返りと次に活かせるポイントを短くアドバイスしてください。'
      : '今日の記録を踏まえて、残り時間の過ごし方や明日への小さなヒントを短くアドバイスしてください。'
  return [
    {
      role: 'system',
      content: `${COACH_ADVICE_SYSTEM_PROMPT}\n\n[ユーザーの記録]\n${context}`,
    },
    { role: 'user', content: ask },
  ]
}

// Qwen3 系で稀に <think> ブロックが出る場合の除去。
const stripThink = (text) => {
  if (!text) return ''
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/g, '')
  const open = out.indexOf('<think>')
  if (open >= 0) out = out.slice(0, open)
  return out.trim()
}

// ---- 公開 API --------------------------------------------------------------

// 現在のキャッシュ状況を返す。
//   - cached: row | null
//   - context: 直近のコンテキスト (再生成判定用)
//   - hash: 直近のスナップショットハッシュ
//   - isStale: cached があるが snapshot_hash が一致しない (再生成推奨)
export const inspectAdvice = async ({ date, modelId }) => {
  const [cached, context] = await Promise.all([
    getCachedAdvice(date),
    buildAdviceContextForDate(date),
  ])
  const hash = computeSnapshotHash({ context, modelId })
  return {
    cached,
    context,
    hash,
    isStale: !!cached && cached.snapshot_hash !== hash,
  }
}

// 生成本体。呼び出し側でロール swap 済み (currentRole === 'coach' && llm.isReady) を保証してから呼ぶ。
export const generateAdvice = async ({ date, llm, modelId, kind = 'today' }) => {
  const context = await buildAdviceContextForDate(date)
  const hash = computeSnapshotHash({ context, modelId })
  const messages = buildAdviceMessages(context, kind)
  const raw = await llm.generate(messages)
  const text = stripThink(raw)
  if (!text) throw new Error('空の応答が返りました')
  await saveAdvice({ date, snapshotHash: hash, adviceText: text, modelId })
  return { text, hash }
}
