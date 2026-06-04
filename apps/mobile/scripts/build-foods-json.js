/* eslint-disable no-console */
// 文部科学省「日本食品標準成分表（八訂）増補2023年」本表 Excel → assets/data/foods.json
//
// 構造（実物確認済み 2026/03/27 版）:
//   Row 1-9 付近に多段ヘッダ
//     Row 1: 食品群 / 食品番号 / 索引番号 / "可食部100g当たり"
//     Row 2: ... / 食品名 / 廃棄率 / エネルギー / 水分 / たんぱく質 / 脂質 / 炭水化物 / ...
//     Row 10: 単位行（"%", "kJ", "kcal", "g", "mg" など）
//     Row 11: 成分識別子（"REFUSE", "ENERC", "ENERC_KCAL", "PROTCAA", "PROT-", "FAT-", "CHOCDF", "NACL_EQ"...）
//     Row 12+: データ
//   各食品群シート（"1穀類", "2いも..." 等）と「表全体」が並ぶ。「表全体」を使う。
//
// 戦略: 成分識別子（英語コード）でカラムを特定する（Japanese ヘッダは表記揺れに弱い）。
//   食品群/食品番号/食品名 だけは Japanese ヘッダから拾う。

const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')

const SCRIPT_DIR = __dirname
const DATA_DIR = path.join(SCRIPT_DIR, 'data')
const OUTPUT_DIR = path.join(SCRIPT_DIR, '..', 'assets', 'data')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'foods.json')

const PREFERRED_SHEET = '表全体'

// 成分識別子 → 出力フィールド名
// 実物の本表 (2026/03/27 版) で確認したコード:
//   ENERC_KCAL kcal、PROT- たんぱく質、FAT- 脂質、CHOCDF- 炭水化物（差引法）、NACL_EQ 食塩相当量
const ID_TO_FIELD = {
  ENERC_KCAL: 'kcal_per_100g',
  'PROT-': 'protein_per_100g',
  'FAT-': 'fat_per_100g',
  'CHOCDF-': 'carb_per_100g',
  NACL_EQ: 'salt_per_100g',
}

const REQUIRED_NUTRIENTS = ['ENERC_KCAL']

const norm = (s) => String(s ?? '').replace(/[\s　\r\n]/g, '')

const parseValue = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (s === '' || s === '-' || s === '−' || s === '－') return null
  if (s === 'Tr' || s === 'tr' || s === '微量') return 0
  const stripped = s.replace(/^[（(]/, '').replace(/[)）]$/, '')
  const n = parseFloat(stripped)
  return Number.isNaN(n) ? null : n
}

const findXlsxFile = () => {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`データディレクトリが見つかりません: ${DATA_DIR}`)
  }
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~'))
    .map((f) => path.join(DATA_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  if (files.length === 0) throw new Error(`${DATA_DIR} に .xlsx が見つかりません。`)
  return files[0]
}

// 行の中で「food_code/name/category」をテキスト一致で特定。
// ヘッダは2-3行に分かれているので、複数行を跨いだ列ごとの結合文字列で探す。
const findTextColumns = (rows, scanUntil = 12) => {
  const cols = {}
  const colCount = Math.max(...rows.slice(0, scanUntil).map((r) => (r ?? []).length), 0)
  for (let c = 0; c < colCount; c += 1) {
    const merged = norm(
      [rows[0]?.[c], rows[1]?.[c], rows[2]?.[c], rows[3]?.[c]]
        .filter((x) => x != null)
        .join(''),
    )
    if (!merged) continue
    if (cols.food_code == null && merged.includes('食品番号')) cols.food_code = c
    if (cols.category == null && merged.includes('食品群')) cols.category = c
    if (cols.name == null && merged.includes('食品名')) cols.name = c
  }
  return cols
}

// 成分識別子行（"ENERC_KCAL" などを含む行）を特定。
const findIdentifierRow = (rows, scanUntil = 20) => {
  for (let i = 0; i < Math.min(scanUntil, rows.length); i += 1) {
    const row = rows[i] ?? []
    const text = row.map((c) => norm(c)).join('|')
    if (text.includes('ENERC_KCAL')) return i
  }
  return -1
}

const mapIdentifierColumns = (idRow) => {
  const mapping = {}
  ;(idRow ?? []).forEach((cell, idx) => {
    const code = String(cell ?? '').trim()
    if (!code) return
    if (ID_TO_FIELD[code]) {
      mapping[ID_TO_FIELD[code]] = idx
    }
  })
  return mapping
}

const extractFromSheet = (ws) => {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
  const textCols = findTextColumns(rows)
  if (textCols.food_code == null || textCols.name == null) {
    return { error: 'food_code or name 列が見つからない' }
  }
  const idRowIdx = findIdentifierRow(rows)
  if (idRowIdx < 0) {
    return { error: '成分識別子行（ENERC_KCAL を含む行）が見つからない' }
  }
  const nutrientCols = mapIdentifierColumns(rows[idRowIdx])
  const missing = REQUIRED_NUTRIENTS.filter((id) => nutrientCols[ID_TO_FIELD[id]] == null)
  if (missing.length > 0) {
    return { error: `必須栄養素列が見つからない: ${missing.join(', ')}` }
  }

  const items = []
  for (let i = idRowIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const food = {}
    // text columns
    const codeRaw = row[textCols.food_code]
    const nameRaw = row[textCols.name]
    const code = codeRaw == null ? '' : String(codeRaw).trim()
    const name = nameRaw == null ? '' : String(nameRaw).trim()
    if (!code || !name) continue
    if (code === '食品番号' || code === '成分識別子') continue
    food.food_code = code
    food.name = name
    if (textCols.category != null) {
      const cat = row[textCols.category]
      if (cat != null && String(cat).trim() !== '') food.category = String(cat).trim()
    }
    // nutrient columns
    Object.entries(nutrientCols).forEach(([field, colIdx]) => {
      const v = parseValue(row[colIdx])
      if (v != null) food[field] = v
    })
    items.push(food)
  }
  return { items, textCols, nutrientCols }
}

const main = () => {
  const xlsxPath = findXlsxFile()
  console.log(`[in]  ${xlsxPath}`)
  const workbook = XLSX.readFile(xlsxPath, { cellDates: false })

  const sheetsToTry = workbook.SheetNames.includes(PREFERRED_SHEET)
    ? [PREFERRED_SHEET, ...workbook.SheetNames.filter((s) => s !== PREFERRED_SHEET)]
    : workbook.SheetNames

  let chosen = null
  for (const sheetName of sheetsToTry) {
    const result = extractFromSheet(workbook.Sheets[sheetName])
    if (result.error) {
      console.log(`[skip] シート「${sheetName}」: ${result.error}`)
      continue
    }
    if (result.items.length === 0) {
      console.log(`[skip] シート「${sheetName}」: データ0件`)
      continue
    }
    console.log(`[ok]   シート「${sheetName}」: ${result.items.length} 件`)
    console.log('       text cols:', result.textCols)
    console.log('       nutrient cols:', result.nutrientCols)
    chosen = result
    break
  }

  if (!chosen) {
    throw new Error('どのシートからも本表データを検出できませんでした。')
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const payload = {
    source: '日本食品標準成分表（八訂）増補2023年',
    generated_at: new Date().toISOString(),
    count: chosen.items.length,
    items: chosen.items,
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload), 'utf-8')
  console.log(`[out] ${OUTPUT_PATH} (${chosen.items.length} foods, ${(fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1)} KB)`)
}

try {
  main()
} catch (e) {
  console.error('ERROR:', e.message)
  process.exit(1)
}
