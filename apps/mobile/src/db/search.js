import { getDb } from './index'
import { lookupAlias } from '../data/foodAliases'
import { lookupPortion } from '../data/portionWeights'

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
//   1. エイリアス辞書を見る → 食品コード直引き（最高精度）
//   2. ヒットしなければ通常のあいまい検索の先頭を返す
export const findBestFood = async (query) => {
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
//   - "g" (グラム) → 直接計算
//   - その他の単位 → portionWeights を引いて 1単位あたりのグラム換算 → 計算
//   - 上記いずれも不可で matched が Slism (kcal_per_serving あり) かつ単位が
//     "個/杯/人前/皿/…" 系なら、1 serving 換算でフォールバック
//   - どれも当たらなければ null
export const computeKcalFromMatch = (matchedFood, quantity, unit, originalName) => {
  if (!matchedFood || matchedFood.kcal_per_100g == null) return null
  if (quantity == null || quantity <= 0) return null
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
