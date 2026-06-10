/* eslint-disable no-console */
// 文部科学省 日本食品標準成分表 別表 (アミノ酸 / 脂肪酸 / 炭水化物) Excel → JSON
//
// 用途: 将来 foods.json に栄養素を追加する時に備えてアーカイブ化する。
//   現状は assets/data に取り込まず _temp/xlsx_json/ (gitignored) に出す。
//
// 入力: _temp/xlsx/20260327-mxt_kagsei-mext-000029402_{04,05,06,07,09,10,11,13,14,15}.xlsx
//   (_02 = 本表 は foods.json と同一内容のためスキップ)
//
// 出力: _temp/xlsx_json/{basename}.json
//   {
//     source, table, generated_at, count,
//     identifiers: ["ILE", "LEU", ...],   // この表で使われている成分識別子
//     items: [{ food_code, category, name, <ID>: value, ... }]
//   }
//
// 構造検出ロジック (build-foods-json.js と同じ):
//   - 「表全体」シートを使う
//   - 食品群 / 食品番号 / 食品名 列を日本語ヘッダから特定
//   - 「成分識別子」行をマーカー (D 列が "成分識別子") で特定し、
//     その行の各セルをそのまま栄養素キーとして採用
//   - データは識別子行の次の行から

const path = require('path')
const fs = require('fs')
const XLSX = require('xlsx')

const REPO_ROOT = path.join(__dirname, '..', '..', '..')
const INPUT_DIR = path.join(REPO_ROOT, '_temp', 'xlsx')
const OUTPUT_DIR = path.join(REPO_ROOT, '_temp', 'xlsx_json')

const PREFERRED_SHEET = '表全体'

// _02 は本表 (foods.json と完全一致) のためスキップ
const SKIP_SUFFIX = ['_02']

// ファイル番号 → 表の種別ラベル (人間が読む用; どの分冊か追えるように)
const TABLE_LABELS = {
  _04: 'アミノ酸成分表 (可食部 100g 当たり)',
  _05: 'アミノ酸成分表 (基準窒素 1g 当たり)',
  _06: 'アミノ酸成分表 (アミノ酸組成によるたんぱく質 1g 当たり)',
  _07: 'アミノ酸成分表 (第4表 別途)',
  _09: '脂肪酸成分表 (可食部 100g 当たり)',
  _10: '脂肪酸成分表 (脂肪酸総量 100g 当たり)',
  _11: '脂肪酸成分表 (脂質 1g 当たり)',
  _13: '炭水化物成分表 (利用可能炭水化物・糖アルコール)',
  _14: '炭水化物成分表 (食物繊維)',
  _15: '炭水化物成分表 (有機酸)',
}

const norm = (s) => String(s ?? '').replace(/[\s　\r\n]/g, '')

const parseValue = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return v
  const s = String(v).trim()
  if (s === '' || s === '-' || s === '−' || s === '－') return null
  if (s === 'Tr' || s === 'tr' || s === '微量') return 0
  // (123) は推定値 → 数値として採用 (元表記がカッコ付きであることは別途識別子が示す慣行)
  const stripped = s.replace(/^[（(]/, '').replace(/[)）]$/, '')
  const n = parseFloat(stripped)
  return Number.isNaN(n) ? null : n
}

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

// 「成分識別子」をマーカーとして識別子行を特定。本表 _02 では D 列が
// "成分識別子" になっていた。別表でも同じ慣行を採用しているはず。
const findIdentifierRow = (rows, scanUntil = 25) => {
  for (let i = 0; i < Math.min(scanUntil, rows.length); i += 1) {
    const row = rows[i] ?? []
    for (const cell of row) {
      if (norm(cell) === '成分識別子') return i
    }
  }
  return -1
}

const extractFromSheet = (ws) => {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })
  const textCols = findTextColumns(rows)
  if (textCols.food_code == null || textCols.name == null) {
    return { error: 'food_code or name 列が見つからない' }
  }
  const idRowIdx = findIdentifierRow(rows)
  if (idRowIdx < 0) return { error: '「成分識別子」行が見つからない' }

  // 識別子行から栄養素列を取得 (食品名 / 食品番号 / 食品群 列は除外)
  const idRow = rows[idRowIdx] ?? []
  const excludeCols = new Set(
    [textCols.food_code, textCols.category, textCols.name].filter((x) => x != null),
  )
  const nutrientCols = {} // identifier (string) → column index
  idRow.forEach((cell, idx) => {
    if (excludeCols.has(idx)) return
    const code = String(cell ?? '').trim()
    if (!code) return
    if (code === '成分識別子') return
    // 重複する識別子がある場合は最初の出現を優先
    if (nutrientCols[code] == null) nutrientCols[code] = idx
  })

  const identifiers = Object.keys(nutrientCols)

  const items = []
  for (let i = idRowIdx + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const codeRaw = row[textCols.food_code]
    const nameRaw = row[textCols.name]
    const code = codeRaw == null ? '' : String(codeRaw).trim()
    const name = nameRaw == null ? '' : String(nameRaw).trim()
    if (!code || !name) continue
    if (code === '食品番号' || code === '成分識別子') continue
    // 食品番号は 5 桁数字
    if (!/^\d{5}$/.test(code)) continue

    const food = { food_code: code, name }
    if (textCols.category != null) {
      const cat = row[textCols.category]
      if (cat != null && String(cat).trim() !== '') food.category = String(cat).trim()
    }
    identifiers.forEach((id) => {
      const v = parseValue(row[nutrientCols[id]])
      if (v != null) food[id] = v
    })
    items.push(food)
  }
  return { items, textCols, identifiers }
}

const tableLabelFor = (basename) => {
  const m = basename.match(/_(\d{2})\.xlsx$/i)
  if (!m) return null
  return TABLE_LABELS[`_${m[1]}`] ?? null
}

const main = () => {
  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`入力ディレクトリが見つかりません: ${INPUT_DIR}`)
  }
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const files = fs
    .readdirSync(INPUT_DIR)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~'))
    .filter((f) => !SKIP_SUFFIX.some((s) => f.includes(s + '.')))
    .sort()

  if (files.length === 0) {
    throw new Error(`${INPUT_DIR} に対象 xlsx が見つかりません。`)
  }

  console.log(`[in]  ${INPUT_DIR} (${files.length} files)`)
  const summary = []
  for (const fn of files) {
    const inPath = path.join(INPUT_DIR, fn)
    const outName = path.basename(fn, path.extname(fn)) + '.json'
    const outPath = path.join(OUTPUT_DIR, outName)
    console.log(`\n--- ${fn} ---`)
    try {
      const workbook = XLSX.readFile(inPath, { cellDates: false })
      const sheetName = workbook.SheetNames.includes(PREFERRED_SHEET)
        ? PREFERRED_SHEET
        : workbook.SheetNames[0]
      const result = extractFromSheet(workbook.Sheets[sheetName])
      if (result.error) {
        console.log(`[skip] ${result.error}`)
        continue
      }
      const label = tableLabelFor(fn)
      const payload = {
        source: '日本食品標準成分表（八訂）増補2023年 / 2026-03-27 公開版',
        table: label,
        source_file: fn,
        generated_at: new Date().toISOString(),
        count: result.items.length,
        identifiers: result.identifiers,
        items: result.items,
      }
      fs.writeFileSync(outPath, JSON.stringify(payload), 'utf-8')
      const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
      console.log(`[ok]  sheet="${sheetName}" items=${result.items.length} ids=${result.identifiers.length} size=${sizeKB}KB`)
      console.log(`      identifiers: ${result.identifiers.slice(0, 10).join(', ')}${result.identifiers.length > 10 ? ', ...' : ''}`)
      summary.push({ file: fn, label, count: result.items.length, identifiers: result.identifiers.length, sizeKB })
    } catch (e) {
      console.error(`[err] ${fn}: ${e.message}`)
    }
  }

  console.log(`\n=== summary ===`)
  console.log(`out dir: ${OUTPUT_DIR}`)
  summary.forEach((s) =>
    console.log(`  ${s.file.padEnd(50)} ${String(s.count).padStart(5)} items  ${String(s.identifiers).padStart(3)} ids  ${s.sizeKB} KB  (${s.label ?? '?'})`),
  )
}

try {
  main()
} catch (e) {
  console.error('ERROR:', e.message)
  process.exit(1)
}
