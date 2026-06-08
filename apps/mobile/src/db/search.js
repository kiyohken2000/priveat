import { getDb } from './index'
import { lookupAlias } from '../data/foodAliases'
import { lookupPortion } from '../data/portionWeights'
import { findRecipeByExactName } from './recipes'
import { findProductByExactName } from './products'

// 文科省成分表の名前は "こめ　［水稲穀粒］　玄米" のように全角空白とブラケットを多用するので
// 検索時には両方を取り除いた版でも一致を試す。
// Slism は alternateName (別名) を別列 alt_name に持つので、こちらも検索対象に含める。

const stripAnnotations = (s) => {
  if (!s) return ''
  return String(s)
    .replace(/[［\[][^］\]]*[］\]]/g, '') // ［...］ や [...] を中身ごと除去
    .replace(/[\s　]/g, '') // 半角・全角空白を除去
    .toLowerCase()
}

const SQL_NORMALIZED_NAME = `
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', ''), '　', ''), '［', ''), '］', ''), '[', ''), ']', '')
`
const SQL_NORMALIZED_ALT = `
  REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(alt_name, ''), ' ', ''), '　', ''), '［', ''), '］', ''), '[', ''), ']', '')
`

const SELECT_COLUMNS = `id, food_code, name, category, source, alt_name,
  kcal_per_100g, protein_per_100g, fat_per_100g, carb_per_100g, salt_per_100g,
  fiber_per_100g, serving_size_g, kcal_per_serving`

// 食品コードで直接1件取得（エイリアスルート）。
const getFoodByCode = async (code) => {
  const db = getDb()
  const row = await db.getFirstAsync(
    `SELECT ${SELECT_COLUMNS} FROM foods WHERE food_code = ?`,
    [code],
  )
  return row ?? null
}

// 名前であいまい検索（正規化後の完全/前方/部分一致でスコア付け）。
//   - score=0 (完全一致) のときは八訂 (source='mext') を優先 (公式値を優先)
//   - score>=1 (前方/部分一致) のときは Slism (source='slism') を優先
//     → 「ラーメン」などの完成料理 query で八訂の素材 (中華めん ゆで) に流れず、
//        Slism の完成料理に当てる
//   - alt_name (Slism の別名) も検索対象
export const searchFoodsByName = async (query, limit = 5) => {
  const db = getDb()
  const q = String(query ?? '').trim()
  if (!q) return []
  const normalized = stripAnnotations(q)
  if (!normalized) return []

  const sql = `
    SELECT ${SELECT_COLUMNS},
           CASE
             WHEN ${SQL_NORMALIZED_NAME} = ? THEN 0
             WHEN ${SQL_NORMALIZED_ALT} = ?  THEN 0
             WHEN ${SQL_NORMALIZED_NAME} LIKE ? THEN 1
             WHEN ${SQL_NORMALIZED_ALT} LIKE ?  THEN 1
             ELSE 2
           END AS score
      FROM foods
     WHERE ${SQL_NORMALIZED_NAME} LIKE ? OR ${SQL_NORMALIZED_ALT} LIKE ?
     ORDER BY score ASC,
              CASE
                WHEN score = 0 AND source = 'mext'  THEN 0
                WHEN score = 0 AND source = 'slism' THEN 1
                WHEN source = 'slism' THEN 0
                ELSE 1
              END,
              LENGTH(name) ASC
     LIMIT ?
  `
  const params = [
    normalized,
    normalized,
    `${normalized}%`,
    `${normalized}%`,
    `%${normalized}%`,
    `%${normalized}%`,
    limit,
  ]
  return db.getAllAsync(sql, params)
}

// LLM が抽出した name に対応する1件を返す。
//   1. 自炊レシピの完全一致を優先 (ユーザー登録「カレー」は Slism「カレーライス」より優先)
//      → recipe 行を foods スキーマ互換に正規化して返す (kind='recipe' タグ付き)
//   2. エイリアス辞書を見る → 食品コード直引き（最高精度）
//   3. ヒットしなければ通常のあいまい検索の先頭を返す
//
// 戻り値の形:
//   - foods 行 (kind 未指定 = food)
//   - recipe 行を foods 互換に変換したもの (kind='recipe', kcal_per_serving あり)
//
// recipe 互換変換は kcal_per_serving を保ち、 kcal_per_100g を null にする
// (= computeKcalFromMatch の serving 単位フォールバック経路に乗る)。
// ただし matched 自身の判定に kcal_per_100g を使う箇所があるので、
// computeKcalFromMatch 側で kind='recipe' を特別扱いする。
const adaptRecipeAsMatch = (recipe) => ({
  id: recipe.id,
  food_code: null,
  name: recipe.name,
  category: null,
  source: 'recipe',
  alt_name: null,
  kcal_per_100g: null,
  protein_per_100g: null,
  fat_per_100g: null,
  carb_per_100g: null,
  salt_per_100g: null,
  fiber_per_100g: null,
  serving_size_g: null,
  kcal_per_serving: recipe.kcal_per_serving,
  kind: 'recipe',
})

// マイ食品 (products) を foods スキーマ互換に正規化する。
// products は「1 単位 (= serving_desc) あたり」 の kcal/PFC を持つので
// kcal_per_serving に詰めて serving 系単位のフォールバック経路に乗せる。
// FoodNameInput のサジェスト統合からも使うため export する。
export const adaptProductAsMatch = (product) => ({
  id: product.id,
  food_code: null,
  name: product.name,
  category: null,
  source: product.source ?? 'label_ocr',
  alt_name: null,
  kcal_per_100g: null,
  protein_per_100g: null,
  fat_per_100g: null,
  carb_per_100g: null,
  salt_per_100g: null,
  fiber_per_100g: null,
  serving_size_g: null,
  kcal_per_serving: product.kcal,
  serving_desc: product.serving_desc ?? null,
  image_uri: product.image_uri ?? null,
  kind: 'product',
})

export const findBestFood = async (query) => {
  const recipe = await findRecipeByExactName(query).catch(() => null)
  if (recipe && recipe.kcal_per_serving != null) {
    return adaptRecipeAsMatch(recipe)
  }
  const product = await findProductByExactName(query).catch(() => null)
  if (product && product.kcal != null) {
    return adaptProductAsMatch(product)
  }
  const code = lookupAlias(query)
  if (code) {
    const direct = await getFoodByCode(code)
    if (direct) return direct
  }
  const rows = await searchFoodsByName(query, 1)
  return rows[0] ?? null
}

// Slism の serving フォールバックが効く単位（「1個」「1杯」「1人前」「1皿」「1盛」など）。
const SERVING_LIKE_UNITS = new Set([
  '個', '杯', '人前', '皿', '盛', '食', '玉', '本', '枚',
  'こ', 'はい', 'にんまえ', 'さら', 'もり', 'しょく', 'たま', 'ほん', 'まい',
])

// 数量・単位から kcal を計算する。
//   - matched が自炊レシピ (kind='recipe') → kcal_per_serving × quantity (単位は食/杯系想定)
//   - "g" (グラム) → 直接計算
//   - その他の単位 → portionWeights を引いて 1単位あたりのグラム換算 → 計算
//   - 上記いずれも不可で matched が Slism (kcal_per_serving あり) かつ単位が
//     "個/杯/人前/皿/…" 系なら、1 serving 換算でフォールバック
//   - どれも当たらなければ null
export const computeKcalFromMatch = (matchedFood, quantity, unit, originalName) => {
  if (!matchedFood) return null
  if (quantity == null || quantity <= 0) return null
  // 自炊レシピは「1食 = kcal_per_serving」固定で計算する。 単位が serving 系で
  // なくても (例: "1個" のような表記揺れ) 食数として扱う方が実用的。
  if (matchedFood.kind === 'recipe') {
    if (matchedFood.kcal_per_serving == null) return null
    return Math.round(matchedFood.kcal_per_serving * quantity)
  }
  // マイ食品も serving 系として扱う。 単位が g/グラム のときだけ別計算が必要だが
  // products は per_100g を持たないので非対応 (= null)。
  if (matchedFood.kind === 'product') {
    if (matchedFood.kcal_per_serving == null) return null
    return Math.round(matchedFood.kcal_per_serving * quantity)
  }
  if (matchedFood.kcal_per_100g == null) return null
  const u = String(unit ?? '').trim().toLowerCase()
  if (u === 'g' || u === 'グラム') {
    return Math.round((matchedFood.kcal_per_100g * quantity) / 100)
  }
  // g 以外: portionWeights で 1単位 → g 換算を試す。
  // LLM が抽出した元の name で引く（matched 側の MEXT 名は冗長で表記揺れが激しいため）
  const gramsPerUnit = lookupPortion(originalName, unit)
  if (gramsPerUnit != null) {
    return Math.round((matchedFood.kcal_per_100g * gramsPerUnit * quantity) / 100)
  }
  // Slism フォールバック: serving 系の単位なら kcal_per_serving を使う
  if (matchedFood.kcal_per_serving != null && SERVING_LIKE_UNITS.has(u)) {
    return Math.round(matchedFood.kcal_per_serving * quantity)
  }
  return null
}
