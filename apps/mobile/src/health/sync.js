import AsyncStorage from '@react-native-async-storage/async-storage'
import { getDb } from '../db'
import { fetchHealthSamples } from './index'

// 最終同期日時 (ISO) の保存先。 HealthScreen と History の両方から共有する。
export const LAST_HEALTH_SYNC_KEY = '@priveat/health-last-sync'

export const getLastHealthSync = async () => {
  try {
    return await AsyncStorage.getItem(LAST_HEALTH_SYNC_KEY)
  } catch (e) {
    return null
  }
}

export const setLastHealthSync = async (iso) => {
  try {
    await AsyncStorage.setItem(LAST_HEALTH_SYNC_KEY, iso)
  } catch (e) {
    // 失敗しても本体の同期は成功しているので silent
  }
}

// 「YYYY-MM-DD」キー。SQLite の date() 関数と互換になるよう ISO date 部分を使う。
const dayKey = (iso) => {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 各日の正午を「その日の logged_at」とする（タイムゾーン差で日付が前後にズレないように）。
const noonOfDay = (day) => new Date(`${day}T12:00:00`).toISOString()

const groupByDay = (samples) => {
  const map = new Map()
  for (const s of samples) {
    if (s?.time == null || s?.value == null) continue
    const k = dayKey(s.time)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(s)
  }
  return map
}

// 体重: その日の最新サンプル1件を保存。
const upsertWeightDays = async (db, samples) => {
  const byDay = groupByDay(samples)
  let inserted = 0
  let updated = 0
  for (const [day, daySamples] of byDay.entries()) {
    daySamples.sort((a, b) => new Date(b.time) - new Date(a.time))
    const latest = daySamples[0]
    const measuredAt = new Date(latest.time).toISOString()

    const existing = await db.getFirstAsync(
      `SELECT id FROM weight_log
       WHERE source = 'health' AND date(measured_at) = date(?)`,
      [measuredAt],
    )
    if (existing) {
      await db.runAsync(
        `UPDATE weight_log SET measured_at = ?, weight_kg = ? WHERE id = ?`,
        [measuredAt, latest.value, existing.id],
      )
      updated += 1
    } else {
      await db.runAsync(
        `INSERT INTO weight_log (measured_at, weight_kg, source)
         VALUES (?, ?, 'health')`,
        [measuredAt, latest.value],
      )
      inserted += 1
    }
  }
  return { inserted, updated, days: byDay.size }
}

// 消費カロリー + 歩数: 日ごとに合算して 1 行にまとめる。
const upsertEnergyDays = async (db, energySamples, stepsSamples) => {
  const energyByDay = groupByDay(energySamples)
  const stepsByDay = groupByDay(stepsSamples)
  const allDays = new Set([...energyByDay.keys(), ...stepsByDay.keys()])
  let inserted = 0
  let updated = 0
  for (const day of allDays) {
    const eList = energyByDay.get(day) ?? []
    const sList = stepsByDay.get(day) ?? []
    const totalKcal = eList.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
    const totalSteps = sList.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
    if (totalKcal === 0 && totalSteps === 0) continue

    const loggedAt = noonOfDay(day)
    const existing = await db.getFirstAsync(
      `SELECT id FROM energy_log
       WHERE source = 'health' AND date(logged_at) = date(?)`,
      [loggedAt],
    )
    if (existing) {
      await db.runAsync(
        `UPDATE energy_log SET active_kcal = ?, steps = ? WHERE id = ?`,
        [totalKcal, Math.round(totalSteps), existing.id],
      )
      updated += 1
    } else {
      await db.runAsync(
        `INSERT INTO energy_log (logged_at, active_kcal, steps, source)
         VALUES (?, ?, ?, 'health')`,
        [loggedAt, totalKcal, Math.round(totalSteps)],
      )
      inserted += 1
    }
  }
  return { inserted, updated, days: allDays.size }
}

// 同期エントリーポイント。
//   1. 権限要求 + 過去 daysBack 日分のデータ取得（iOS はネイティブ集計済の1日1値）
//   2. 日ごとに集計
//   3. weight_log / energy_log に upsert（source='health'）
//   トランザクションで一気に書き込んで途中失敗時にロールバック。
export const syncHealthToDb = async ({ daysBack = 30 } = {}) => {
  const data = await fetchHealthSamples({ daysBack, limit: -1 })
  const db = getDb()

  let weight = { inserted: 0, updated: 0, days: 0 }
  let energy = { inserted: 0, updated: 0, days: 0 }

  await db.withTransactionAsync(async () => {
    weight = await upsertWeightDays(db, data.weights)
    energy = await upsertEnergyDays(db, data.activeEnergy, data.steps)
  })

  console.log('[health][sync] weight:', weight)
  console.log('[health][sync] energy:', energy)

  return {
    weight,
    energy,
    fetched: {
      weights: data.weights.length,
      activeEnergy: data.activeEnergy.length,
      steps: data.steps.length,
    },
  }
}
