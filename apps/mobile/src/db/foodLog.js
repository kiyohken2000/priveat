import { getDb } from './index'

export const PORTION_FACTORS = { small: 0.7, normal: 1.0, large: 1.3 }
export const portionFactor = (p) => PORTION_FACTORS[p] ?? 1.0

// items 配列を food_log にまとめて INSERT する。
//
// 1件あたりの item は:
//   { name, quantity, unit, portion, baseKcal, matchedFoodId? }
// baseKcal は「並 (factor=1.0)」相当の値。実際の保存値は portion factor を掛けて算出する。
//
// 戻り値: 挿入された food_log.id の配列（呼び元で後の UPDATE/DELETE に使える）
export const insertFoodLogItems = async (items, options = {}) => {
  if (!items || items.length === 0) return []
  const db = getDb()
  const {
    mealType = null,
    eatenAt = new Date().toISOString(),
    source = 'text_llm',
  } = options

  const insertedIds = []
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT INTO food_log
         (eaten_at, meal_type, name, quantity, unit, portion, kcal,
          ref_food_id, ref_kind, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    try {
      for (const item of items) {
        const factor = portionFactor(item.portion)
        const kcal = item.baseKcal != null ? Math.round(item.baseKcal * factor) : null
        // eslint-disable-next-line no-await-in-loop
        const res = await stmt.executeAsync([
          eatenAt,
          mealType,
          item.name,
          item.quantity ?? null,
          item.unit ?? null,
          item.portion ?? 'normal',
          kcal,
          item.matchedFoodId ?? null,
          item.matchedFoodId != null ? 'food' : null,
          source,
        ])
        if (res?.lastInsertRowId != null) insertedIds.push(res.lastInsertRowId)
      }
    } finally {
      await stmt.finalizeAsync()
    }
  })
  return insertedIds
}

// 動作確認用: food_log の総レコード数
export const countFoodLog = async () => {
  const db = getDb()
  const row = await db.getFirstAsync('SELECT COUNT(*) as cnt FROM food_log')
  return row?.cnt ?? 0
}
