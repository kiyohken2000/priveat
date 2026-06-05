import { jsonrepair } from 'jsonrepair'

export const FoodSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '正規化した食品名' },
          quantity: { type: 'number', description: '数量' },
          unit: { type: 'string', description: '単位（g/個/本/杯/枚/人前 等）' },
          portion: { type: 'string', description: '大盛り/少なめ 等のニュアンス（任意）' },
        },
        required: ['name', 'quantity', 'unit'],
      },
    },
  },
  required: ['items'],
}

// executorch の getStructuredOutputPrompt をバイパスして同等のプロンプトを作る。
// 内部実装が `responseSchema instanceof zCore.$ZodType` を呼ぶが、zod 4 の RN
// ランタイムで `$ZodType` が undefined になりエラーになるため自前で組む。
export const getFoodSchemaPrompt = () => {
  const schemaString = JSON.stringify(FoodSchema)
  return `The output should be formatted as a JSON instance that conforms to the JSON schema below.

As an example, for the schema {"properties": {"foo": {"title": "Foo", "description": "a list of strings", "type": "array", "items": {"type": "string"}}}, "required": ["foo"]}
the object {"foo": ["bar", "baz"]} is a well-formatted instance of the schema. The object {"properties": {"foo": ["bar", "baz"]}} is not well-formatted.

Here is the output schema:
${schemaString}
`
}

const extractBetweenBrackets = (text) => {
  const startIdx = text.search(/[{[]/)
  if (startIdx < 0) throw new Error('JSON が見つかりません')
  const opening = text[startIdx]
  const closing = opening === '{' ? '}' : ']'
  return text.slice(text.indexOf(opening), text.lastIndexOf(closing) + 1)
}

// 一部の小型 LLM は name / quantity / unit を {"name": {"name": "ささみ"}} のように
// 同名キーで何重にもネストして返してくる。生のフィルタだと全件落ちるので、
// 再帰的に最深部のプリミティブを取り出して救済する。
const coercePrimitive = (value, key, maxDepth = 5) => {
  let cur = value
  for (let i = 0; i < maxDepth; i += 1) {
    if (cur == null) return null
    if (typeof cur === 'string' || typeof cur === 'number') return cur
    if (typeof cur === 'object' && !Array.isArray(cur) && key in cur) {
      cur = cur[key]
      continue
    }
    return null
  }
  return null
}

const coerceName = (raw) => {
  const v = coercePrimitive(raw, 'name')
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number') return String(v)
  return null
}

const coerceQuantity = (raw) => {
  const v = coercePrimitive(raw, 'quantity')
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    if (!Number.isNaN(n)) return n
  }
  return null
}

const coerceUnit = (raw) => {
  const v = coercePrimitive(raw, 'unit')
  if (typeof v === 'string' && v.length > 0) return v
  return null
}

// executorch の fixAndValidateStructuredOutput と同様の処理（zod を介さず手書き）。
// モデルが {"items":[...]} を返さず [...] だけを返すケースもよくあるので両方受け入れる。
export const parseFoodOutput = (rawOutput) => {
  const extracted = extractBetweenBrackets(rawOutput)
  const repaired = jsonrepair(extracted)
  const parsed = JSON.parse(repaired)
  const itemsArray = Array.isArray(parsed) ? parsed : parsed?.items
  if (!Array.isArray(itemsArray)) {
    throw new Error('items 配列が見つかりません')
  }
  const items = itemsArray
    .map((it) => {
      if (!it || typeof it !== 'object') return null
      const name = coerceName(it.name)
      if (!name) return null
      return {
        name,
        quantity: coerceQuantity(it.quantity) ?? 1,
        unit: coerceUnit(it.unit) ?? '人前',
        portion: typeof it.portion === 'string' ? it.portion : undefined,
      }
    })
    .filter(Boolean)
  if (items.length === 0) {
    throw new Error('有効な食品が抽出できませんでした')
  }
  return { items }
}

export const normalizePortion = (raw) => {
  if (!raw) return 'normal'
  if (raw.includes('大')) return 'large'
  if (raw.includes('少')) return 'small'
  return 'normal'
}
