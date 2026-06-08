import { getDb } from './index'

// 自炊レシピ (まとめ作り) のマスタ操作。
//
// レシピは「カレーを 5 食分作って total 2400 kcal、 1 食 480 kcal」のような
// 完成料理マスタ。 ingredients は材料の内訳で、 後で再見直しや再計算ができる
// よう残しておく。
//
// 呼び出し側 (Chat の RecipeCard) は:
//   1. parser LLM で {kind:'recipe', name, servings, ingredients:[...]} を得る
//   2. 各 ingredient を findBestFood + computeKcalFromMatch で kcal 化
//   3. saveRecipe(...) で 1 食あたり kcal を確定して DB に書き込む
//
// 戻り値 / 引数は、 row はカラム名そのまま (snake_case)、 引数は呼び元の
// 既存パターンに合わせて camelCase。

const SELECT_RECIPE_COLUMNS = 'id, name, servings, total_kcal, kcal_per_serving, notes, created_at'

export const saveRecipe = async ({
  name,
  servings,
  totalKcal,
  notes = null,
  ingredients = [],
}) => {
  if (!name || !name.trim()) throw new Error('レシピ名は必須です')
  const srv = Number(servings)
  if (!Number.isFinite(srv) || srv <= 0) throw new Error('食数は 1 以上で指定してください')

  const db = getDb()
  const createdAt = new Date().toISOString()
  const kcalPerServing = totalKcal != null ? Math.round(totalKcal / srv) : null
  let recipeId = null

  await db.withTransactionAsync(async () => {
    const res = await db.runAsync(
      `INSERT INTO recipes (name, servings, total_kcal, kcal_per_serving, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name.trim(), srv, totalKcal ?? null, kcalPerServing, notes, createdAt],
    )
    recipeId = res?.lastInsertRowId ?? null
    if (recipeId == null) throw new Error('レシピの保存に失敗しました')

    if (ingredients.length > 0) {
      const stmt = await db.prepareAsync(
        `INSERT INTO recipe_ingredients
           (recipe_id, name, quantity, unit, matched_food_id, kcal, kcal_source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      try {
        // eslint-disable-next-line no-restricted-syntax
        for (const ing of ingredients) {
          // eslint-disable-next-line no-await-in-loop
          await stmt.executeAsync([
            recipeId,
            ing.name,
            ing.quantity ?? null,
            ing.unit ?? null,
            ing.matchedFoodId ?? null,
            ing.kcal ?? null,
            ing.kcalSource ?? null,
          ])
        }
      } finally {
        await stmt.finalizeAsync()
      }
    }
  })
  return recipeId
}

export const getRecipe = async (recipeId) => {
  if (recipeId == null) return null
  const db = getDb()
  const recipe = await db.getFirstAsync(
    `SELECT ${SELECT_RECIPE_COLUMNS} FROM recipes WHERE id = ?`,
    [recipeId],
  )
  if (!recipe) return null
  const ingredients = await db.getAllAsync(
    `SELECT id, name, quantity, unit, matched_food_id, kcal, kcal_source
       FROM recipe_ingredients WHERE recipe_id = ? ORDER BY id`,
    [recipeId],
  )
  return { ...recipe, ingredients }
}

export const listRecipes = async ({ limit = 100 } = {}) => {
  const db = getDb()
  return db.getAllAsync(
    `SELECT ${SELECT_RECIPE_COLUMNS} FROM recipes
      ORDER BY datetime(created_at) DESC LIMIT ?`,
    [limit],
  )
}

export const deleteRecipe = async (recipeId) => {
  if (recipeId == null) return false
  const db = getDb()
  await db.withTransactionAsync(async () => {
    // FK ON DELETE CASCADE が pragma 次第で効かない環境を考えて明示削除も入れる。
    await db.runAsync('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId])
    await db.runAsync('DELETE FROM recipes WHERE id = ?', [recipeId])
  })
  return true
}

// レシピ全体を「現在の materials の合計から」 再計算して書き戻す。
//   total_kcal: 材料の kcal 合計 (どれか null なら null)
//   kcal_per_serving: total_kcal / servings (どちらか欠ければ null)
// updateRecipeIngredient / addRecipeIngredient / deleteRecipeIngredient の
// 後始末で呼ぶ。 ingredients を別途引数で渡せるのは、 トランザクション内で
// 同じ db ハンドルから 1 度だけ SELECT し直して使い回したいケース用。
const recomputeRecipeTotals = async (db, recipeId, ingredientsCache = null) => {
  const ingredients = ingredientsCache ?? (await db.getAllAsync(
    'SELECT kcal FROM recipe_ingredients WHERE recipe_id = ?',
    [recipeId],
  ))
  const meta = await db.getFirstAsync(
    'SELECT servings FROM recipes WHERE id = ?',
    [recipeId],
  )
  const hasUnknown = ingredients.some((ing) => ing.kcal == null)
  const totalKcal = hasUnknown
    ? null
    : ingredients.reduce((sum, ing) => sum + (ing.kcal ?? 0), 0)
  const srv = Number(meta?.servings)
  const kcalPerServing = totalKcal != null && Number.isFinite(srv) && srv > 0
    ? Math.round(totalKcal / srv)
    : null
  await db.runAsync(
    'UPDATE recipes SET total_kcal = ?, kcal_per_serving = ? WHERE id = ?',
    [totalKcal, kcalPerServing, recipeId],
  )
}

// レシピ本体 (name / servings / notes) を更新する。
//   servings が変わると 1 食あたり kcal も連動するので必ず再計算する。
export const updateRecipeMeta = async (recipeId, fields = {}) => {
  if (recipeId == null) return false
  const sets = []
  const params = []
  if ('name' in fields) {
    const name = String(fields.name ?? '').trim()
    if (!name) throw new Error('レシピ名は必須です')
    sets.push('name = ?')
    params.push(name)
  }
  if ('servings' in fields) {
    const srv = Number(fields.servings)
    if (!Number.isFinite(srv) || srv <= 0) {
      throw new Error('食数は 1 以上で指定してください')
    }
    sets.push('servings = ?')
    params.push(srv)
  }
  if ('notes' in fields) {
    sets.push('notes = ?')
    params.push(fields.notes ?? null)
  }
  if (sets.length === 0) return false
  const db = getDb()
  await db.withTransactionAsync(async () => {
    params.push(recipeId)
    await db.runAsync(`UPDATE recipes SET ${sets.join(', ')} WHERE id = ?`, params)
    await recomputeRecipeTotals(db, recipeId)
  })
  return true
}

// 1 材料行を更新する。 kcal が変わったらレシピ合計も連動する。
export const updateRecipeIngredient = async (ingredientId, fields = {}) => {
  if (ingredientId == null) return false
  const sets = []
  const params = []
  if ('name' in fields) {
    const name = String(fields.name ?? '').trim()
    if (!name) throw new Error('材料名は必須です')
    sets.push('name = ?')
    params.push(name)
  }
  if ('quantity' in fields) {
    sets.push('quantity = ?')
    params.push(fields.quantity ?? null)
  }
  if ('unit' in fields) {
    sets.push('unit = ?')
    params.push(fields.unit ?? null)
  }
  if ('kcal' in fields) {
    sets.push('kcal = ?')
    params.push(fields.kcal ?? null)
  }
  if ('kcalSource' in fields) {
    sets.push('kcal_source = ?')
    params.push(fields.kcalSource ?? null)
  }
  if ('matchedFoodId' in fields) {
    sets.push('matched_food_id = ?')
    params.push(fields.matchedFoodId ?? null)
  }
  if (sets.length === 0) return false
  const db = getDb()
  let recipeId = null
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync(
      'SELECT recipe_id FROM recipe_ingredients WHERE id = ?',
      [ingredientId],
    )
    recipeId = row?.recipe_id ?? null
    params.push(ingredientId)
    await db.runAsync(
      `UPDATE recipe_ingredients SET ${sets.join(', ')} WHERE id = ?`,
      params,
    )
    if (recipeId != null) await recomputeRecipeTotals(db, recipeId)
  })
  return true
}

// 材料を 1 行追加する。 戻り値は新しい recipe_ingredients.id。
export const addRecipeIngredient = async (recipeId, ing = {}) => {
  if (recipeId == null) throw new Error('recipeId は必須です')
  const name = String(ing.name ?? '').trim()
  if (!name) throw new Error('材料名は必須です')
  const db = getDb()
  let insertedId = null
  await db.withTransactionAsync(async () => {
    const res = await db.runAsync(
      `INSERT INTO recipe_ingredients
         (recipe_id, name, quantity, unit, matched_food_id, kcal, kcal_source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        recipeId,
        name,
        ing.quantity ?? null,
        ing.unit ?? null,
        ing.matchedFoodId ?? null,
        ing.kcal ?? null,
        ing.kcalSource ?? null,
      ],
    )
    insertedId = res?.lastInsertRowId ?? null
    await recomputeRecipeTotals(db, recipeId)
  })
  return insertedId
}

// 材料 1 行を削除し、 レシピ合計を再計算する。
// 注意: saveRecipe / RecipeCard 経由で書き込まれる「カードの×ボタン削除」 とは別物。
// こちらは保存済み recipes 行に対する破壊的操作。
export const deleteRecipeIngredientRow = async (ingredientId) => {
  if (ingredientId == null) return false
  const db = getDb()
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync(
      'SELECT recipe_id FROM recipe_ingredients WHERE id = ?',
      [ingredientId],
    )
    const recipeId = row?.recipe_id ?? null
    await db.runAsync('DELETE FROM recipe_ingredients WHERE id = ?', [ingredientId])
    if (recipeId != null) await recomputeRecipeTotals(db, recipeId)
  })
  return true
}

// 名前で完全一致 1 件を返す。 findBestFood が「完全一致時のみ自炊優先」する
// ために使う。 正規化は foods 検索と同じく空白除去 + 小文字化。
export const findRecipeByExactName = async (query) => {
  const db = getDb()
  const q = String(query ?? '').trim()
  if (!q) return null
  const normalized = q.replace(/[\s　]/g, '').toLowerCase()
  if (!normalized) return null
  return db.getFirstAsync(
    `SELECT ${SELECT_RECIPE_COLUMNS}
       FROM recipes
      WHERE LOWER(REPLACE(REPLACE(name, ' ', ''), '　', '')) = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 1`,
    [normalized],
  )
}
