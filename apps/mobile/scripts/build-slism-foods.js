/* eslint-disable no-console */
// scripts/data/slism_raw/*.html (scrape-slism.js の出力) を解析し、
// 八訂 (foods.json) と同じスキーマの foods_slism.json を生成する。
//
// **個人利用専用** — 出力先 assets/data/foods_slism.json は .gitignore 配下。
//
// 戦略:
//   各 HTML 内の JSON-LD (schema.org/NutritionInformation) から栄養データを抽出。
//   servingSize と各成分量から 100g あたりに換算。
//   Recipe (料理) は recipeCategory、MenuItem (食材) は description から (穀類) 等を抽出。
//
// Usage:
//   node scripts/build-slism-foods.js              # 全件処理
//   node scripts/build-slism-foods.js --limit 10   # 最初の 10 件のみ
//   node scripts/build-slism-foods.js --debug 101001  # 1 件をデバッグ表示

const path = require('path')
const fs = require('fs')

const SCRIPT_DIR = __dirname
const RAW_DIR = path.join(SCRIPT_DIR, 'data', 'slism_raw')
const OUTPUT_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'data')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'foods_slism.json')

// food_code の先頭 3 桁 → カテゴリ名 (description から取れない場合のフォールバック)
const CODE_PREFIX_CATEGORY = {
  101: '穀類',
  102: 'いも・でん粉',
  103: '砂糖・甘味',
  104: '豆',
  105: '種実',
  106: '野菜',
  107: '果物',
  108: 'きのこ',
  109: '海藻',
  110: '魚介類',
  111: '肉',
  112: '卵',
  113: '乳製品',
  114: '油脂',
  115: '菓子',
  116: '飲料・酒',
  117: '調味料・香辛料',
  200: '主食',
  300: 'おかず・加工食品',
  400: 'おやつ・お菓子',
  500: '飲み物',
  600: 'その他',
}

const getCategoryFromCode = (code) => {
  const prefix = parseInt(code.substring(0, 3), 10)
  return CODE_PREFIX_CATEGORY[prefix] ?? null
}

// description 例: "アマランサス(穀類)は別名..." または "ペペロンチーノ(主食)は別名..."
const getCategoryFromDescription = (desc) => {
  if (!desc) return null
  const m = desc.match(/[（(]([^（）()]{1,15})[）)]は別名/)
  return m ? m[1] : null
}

const extractJsonLd = (html) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/)
  if (!m) return null
  try {
    return JSON.parse(m[1].trim())
  } catch (e) {
    return null
  }
}

// "51 kcal" → 51, "9.74 g" → 9.74, "5000 mg" → 5000, "277.5 g" → 277.5
const parseNumber = (s) => {
  if (s == null) return null
  const m = String(s).match(/[-+]?\d*\.?\d+/)
  return m ? parseFloat(m[0]) : null
}

// servingSize 基準の値を 100g 換算
const per100g = (value, servingG) => {
  if (value == null || servingG == null || servingG <= 0) return null
  return +(value / servingG * 100).toFixed(2)
}

// Slism の sodiumContent は schema.org 本来の Na (mg) ではなく
// 食塩相当量 (g) を mg 表記したもの (例: ペペロンチーノ 1 食塩分 5g → "5000 mg")。
// サイト本文の「食塩相当量」表記と一致するよう、1000 で割って g に戻す。
const sodiumMgToSaltG = (sodiumMg) => {
  if (sodiumMg == null) return null
  return +(sodiumMg / 1000).toFixed(2)
}

const parseFile = (id) => {
  const filePath = path.join(RAW_DIR, `${id}.html`)
  if (!fs.existsSync(filePath)) return { error: 'file not found' }
  const html = fs.readFileSync(filePath, 'utf-8')
  const ld = extractJsonLd(html)
  if (!ld) return { error: 'no JSON-LD' }
  const nut = ld.nutrition
  if (!nut) return { error: 'no nutrition' }

  const serving = parseNumber(nut.servingSize)
  const kcalServing = parseNumber(nut.calories)
  const proteinServing = parseNumber(nut.proteinContent)
  const fatServing = parseNumber(nut.fatContent)
  const carbServing = parseNumber(nut.carboHydrateContent)
  const sodiumServing = parseNumber(nut.sodiumContent) // mg
  const fiberServing = parseNumber(nut.fiberContent)

  const kcal100 = per100g(kcalServing, serving)
  if (kcal100 == null) return { error: 'kcal/serving missing' }

  const saltServingG = sodiumMgToSaltG(sodiumServing)

  const category =
    (ld['@type'] === 'Recipe' && ld.recipeCategory) ||
    getCategoryFromDescription(ld.description) ||
    getCategoryFromCode(id) ||
    null

  return {
    food: {
      food_code: `slism_${id}`,
      name: ld.name,
      alt_name: ld.alternateName || null,
      category,
      kcal_per_100g: kcal100,
      protein_per_100g: per100g(proteinServing, serving),
      fat_per_100g: per100g(fatServing, serving),
      carb_per_100g: per100g(carbServing, serving),
      salt_per_100g: per100g(saltServingG, serving),
      fiber_per_100g: per100g(fiberServing, serving),
      serving_size_g: serving,
      kcal_per_serving: kcalServing,
    },
  }
}

const debugOne = (id) => {
  const result = parseFile(id)
  console.log(JSON.stringify(result, null, 2))
}

const buildAll = ({ limit } = {}) => {
  if (!fs.existsSync(RAW_DIR)) {
    throw new Error(`raw dir not found: ${RAW_DIR}`)
  }
  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => f.replace('.html', ''))
    .sort()
  const target = limit ? files.slice(0, limit) : files
  console.log(`[build] processing ${target.length} files`)

  const items = []
  const errors = {}
  for (const id of target) {
    const result = parseFile(id)
    if (result.error) {
      errors[result.error] = (errors[result.error] || 0) + 1
      continue
    }
    items.push(result.food)
  }

  console.log(`[build] ok ${items.length}, errors:`, errors)

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const payload = {
    source: 'カロリーSlism (https://calorie.slism.jp) — 個人利用範囲',
    generated_at: new Date().toISOString(),
    count: items.length,
    items,
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload), 'utf-8')
  const size = fs.statSync(OUTPUT_PATH).size
  console.log(`[out] ${OUTPUT_PATH} (${items.length} foods, ${(size / 1024).toFixed(1)} KB)`)
}

const main = () => {
  const args = process.argv.slice(2)
  const debugIdx = args.indexOf('--debug')
  if (debugIdx >= 0) {
    debugOne(args[debugIdx + 1])
    return
  }
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : null
  buildAll({ limit })
}

try {
  main()
} catch (e) {
  console.error('ERROR:', e.message)
  process.exit(1)
}
