import foodsData from '../../assets/data/foods.json'

// foods テーブルが空のときだけ assets/data/foods.json をバルクインサートする。
// 起動時に呼ばれる。トランザクション内 + prepared statement で ~2,500件 を数秒で投入。
export const ensureFoodsSeeded = async (db, onProgress) => {
  const row = await db.getFirstAsync('SELECT COUNT(*) as cnt FROM foods')
  const existing = row?.cnt ?? 0
  if (existing > 0) {
    console.log(`[seed] foods already populated (${existing} rows), skipping`)
    return false
  }

  const items = foodsData.items ?? []
  const total = items.length
  if (total === 0) {
    console.warn('[seed] foods.json is empty, nothing to insert')
    return false
  }

  console.log(`[seed] inserting ${total} foods...`)
  const startedAt = Date.now()

  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT INTO foods
        (food_code, name, category, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g, salt_per_100g)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    try {
      for (let i = 0; i < total; i += 1) {
        const it = items[i]
        // eslint-disable-next-line no-await-in-loop
        await stmt.executeAsync([
          it.food_code ?? null,
          it.name ?? null,
          it.category ?? null,
          it.kcal_per_100g ?? null,
          it.protein_per_100g ?? null,
          it.fat_per_100g ?? null,
          it.carb_per_100g ?? null,
          it.salt_per_100g ?? null,
        ])
        if (onProgress && (i % 100 === 0 || i === total - 1)) {
          onProgress(i + 1, total)
        }
      }
    } finally {
      await stmt.finalizeAsync()
    }
  })

  console.log(`[seed] done in ${Date.now() - startedAt}ms`)
  return true
}
