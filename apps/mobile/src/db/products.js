import { getDb } from './index'
import { persistOcrImage } from '../utils/persistImage'

// 「マイ食品」マスタ (products テーブル) の操作。
//
// products は元々ラベル OCR 経由の登録 (insertProductFromLabel, source='label_ocr')
// 用に作られていたが、 v? からユーザーが手入力で登録できるようにし (source='manual')、
// 設定 → マイ食品 から CRUD できるようにした。
//
// kcal / protein / fat / carb / salt は「1 単位 (= serving_desc) あたり」の値として扱う。
// LabelRecordCard の perUnit と同じ前提。

const SELECT_COLUMNS = `id, barcode, name, kcal, protein, fat, carb, salt,
  serving_desc, source, image_uri, created_at`

export const listProducts = async ({ limit = 200 } = {}) => {
  const db = getDb()
  return db.getAllAsync(
    `SELECT ${SELECT_COLUMNS} FROM products
      ORDER BY datetime(created_at) DESC LIMIT ?`,
    [limit],
  )
}

export const getProduct = async (productId) => {
  if (productId == null) return null
  const db = getDb()
  return db.getFirstAsync(
    `SELECT ${SELECT_COLUMNS} FROM products WHERE id = ?`,
    [productId],
  )
}

// 手入力 (+任意のラベル画像) で products に 1 行追加する。
// チャット経由のラベル OCR 自動登録は ocrLogs.js の insertProductFromLabel を使うこと。
//   imageUri: 撮影/選択直後の URI。 渡された場合は documentDirectory にコピーして
//             image_uri に保存。 失敗時は image_uri=null で続行。
//   source: 'manual' (デフォルト) / 'label_ocr' (ProductEditScreen で OCR 補助あり)
export const insertProductManual = async (fields = {}, options = {}) => {
  const name = String(fields.name ?? '').trim()
  if (!name) throw new Error('食品名は必須です')
  const db = getDb()
  const createdAt = new Date().toISOString()
  const source = options.source ?? 'manual'
  const persisted = options.imageUri
    ? await persistOcrImage(options.imageUri, 'label')
    : null
  const res = await db.runAsync(
    `INSERT INTO products
       (barcode, name, kcal, protein, fat, carb, salt, serving_desc, source, image_uri, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.barcode ?? null,
      name,
      fields.kcal ?? null,
      fields.protein ?? null,
      fields.fat ?? null,
      fields.carb ?? null,
      fields.salt ?? null,
      fields.serving_desc ?? null,
      source,
      persisted,
      createdAt,
    ],
  )
  return res?.lastInsertRowId ?? null
}

// 1 行を更新する。 渡された fields のキーだけ UPDATE する。
const UPDATABLE_FIELDS = ['barcode', 'name', 'kcal', 'protein', 'fat', 'carb', 'salt', 'serving_desc']

export const updateProduct = async (productId, fields = {}) => {
  if (productId == null) return false
  const sets = []
  const params = []
  UPDATABLE_FIELDS.forEach((k) => {
    if (!(k in fields)) return
    if (k === 'name') {
      const name = String(fields.name ?? '').trim()
      if (!name) throw new Error('食品名は必須です')
      sets.push('name = ?')
      params.push(name)
    } else {
      sets.push(`${k} = ?`)
      params.push(fields[k] ?? null)
    }
  })
  if (sets.length === 0) return false
  const db = getDb()
  params.push(productId)
  await db.runAsync(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params)
  return true
}

// サジェスト用: 名前であいまい検索。 foods 検索 (search.js) と同じく
// 空白除去 + 小文字化で正規化してから完全/前方/部分一致でスコア付け。
const stripWhitespace = (s) => String(s ?? '').replace(/[\s　]/g, '').toLowerCase()

const SQL_NORM_PRODUCT_NAME = `
  LOWER(REPLACE(REPLACE(name, ' ', ''), '　', ''))
`

export const searchProductsByName = async (query, limit = 5) => {
  const db = getDb()
  const q = String(query ?? '').trim()
  if (!q) return []
  const normalized = stripWhitespace(q)
  if (!normalized) return []
  const sql = `
    SELECT ${SELECT_COLUMNS},
           CASE
             WHEN ${SQL_NORM_PRODUCT_NAME} = ? THEN 0
             WHEN ${SQL_NORM_PRODUCT_NAME} LIKE ? THEN 1
             ELSE 2
           END AS score
      FROM products
     WHERE ${SQL_NORM_PRODUCT_NAME} LIKE ?
     ORDER BY score ASC, LENGTH(name) ASC, datetime(created_at) DESC
     LIMIT ?
  `
  return db.getAllAsync(sql, [
    normalized,
    `${normalized}%`,
    `%${normalized}%`,
    limit,
  ])
}

// findBestFood が「完全一致時のみマイ食品優先」する際に使う。
export const findProductByExactName = async (query) => {
  const db = getDb()
  const q = String(query ?? '').trim()
  if (!q) return null
  const normalized = stripWhitespace(q)
  if (!normalized) return null
  return db.getFirstAsync(
    `SELECT ${SELECT_COLUMNS} FROM products
      WHERE ${SQL_NORM_PRODUCT_NAME} = ?
      ORDER BY datetime(created_at) DESC LIMIT 1`,
    [normalized],
  )
}

// deleteProductRow は ocrLogs.js 側で image_uri 連動削除を行う実装があるので
// そちらを再エクスポートする (重複実装を避ける)。
export { deleteProductRow } from './ocrLogs'
