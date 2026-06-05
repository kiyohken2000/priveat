import foodsData from '../../assets/data/foods.json'
import foodsSlismData from '../../assets/data/foods_slism.json'

// foods テーブルに 2 ソース (mext = 八訂、slism = カロリーSlism) を seed する。
// source ごとに件数判定し、まだ入っていない方だけバルクインサートする。
// foods_slism.json は public repo には含まれない (個人利用範囲、.gitignore 配下) ので、
// スタブ (count=0) のときは Slism seed をスキップする。
//
// 起動時に呼ばれる。トランザクション内 + prepared statement で数千件を数秒で投入。

const INSERT_SQL = `INSERT INTO foods
  (food_code, name, category, kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g, salt_per_100g,
   source, alt_name, fiber_per_100g, serving_size_g, kcal_per_serving)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const seedItems = async (db, items, source, onProgress) => {
  const total = items.length
  if (total === 0) return 0
  console.log(`[seed:${source}] inserting ${total} foods...`)
  const startedAt = Date.now()
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(INSERT_SQL)
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
          source,
          it.alt_name ?? null,
          it.fiber_per_100g ?? null,
          it.serving_size_g ?? null,
          it.kcal_per_serving ?? null,
        ])
        if (onProgress && (i % 200 === 0 || i === total - 1)) {
          onProgress(source, i + 1, total)
        }
      }
    } finally {
      await stmt.finalizeAsync()
    }
  })
  console.log(`[seed:${source}] done in ${Date.now() - startedAt}ms`)
  return total
}

export const ensureFoodsSeeded = async (db, onProgress) => {
  const mextRow = await db.getFirstAsync(
    `SELECT COUNT(*) as cnt FROM foods WHERE source = 'mext'`,
  )
  const slismRow = await db.getFirstAsync(
    `SELECT COUNT(*) as cnt FROM foods WHERE source = 'slism'`,
  )
  const mextCount = mextRow?.cnt ?? 0
  const slismCount = slismRow?.cnt ?? 0

  let inserted = 0

  if (mextCount === 0) {
    inserted += await seedItems(db, foodsData.items ?? [], 'mext', onProgress)
  } else {
    console.log(`[seed:mext] already populated (${mextCount} rows), skipping`)
  }

  const slismItems = foodsSlismData.items ?? []
  const slismFileCount = slismItems.length
  if (slismFileCount === 0) {
    console.log('[seed:slism] foods_slism.json is empty (stub), skipping')
  } else if (slismCount !== slismFileCount) {
    // ファイル件数と DB 件数が一致しない → 古い seed を一掃して再投入。
    // 初回 (0 → N) はもちろん、N → M (Slism JSON 更新) も自動で追随する。
    // food_log の ref_food_id は外れる可能性があるが、kcal/name は food_log 行内に
    // スナップショット保存されているので表示には影響しない。
    if (slismCount > 0) {
      console.log(`[seed:slism] count mismatch (db=${slismCount}, file=${slismFileCount}), re-seeding`)
      await db.runAsync(`DELETE FROM foods WHERE source = 'slism'`)
    }
    inserted += await seedItems(db, slismItems, 'slism', onProgress)
  } else {
    console.log(`[seed:slism] already populated (${slismCount} rows), skipping`)
  }

  return inserted > 0
}
