import { jsonrepair } from 'jsonrepair'

// multi-intent パーサー出力スキーマ。
//   kind に応じて使うフィールドが変わる discriminated union。
//   food     → items
//   weight   → weight_kg
//   activity → activity_name, duration_min
//   unknown  → kind のみ
export const RecordSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['food', 'weight', 'activity', 'unknown'],
      description: '記録の種類',
    },
    items: {
      type: 'array',
      description: 'kind=food のときのみ使用',
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
    weight_kg: { type: 'number', description: 'kind=weight のときの体重(kg)' },
    activity_name: { type: 'string', description: 'kind=activity のときの種目名' },
    duration_min: { type: 'number', description: 'kind=activity のときの時間(分)。距離だけの入力では省略可' },
    distance_km: { type: 'number', description: 'kind=activity のときの距離(km)。時間だけの入力では省略可' },
  },
  required: ['kind'],
}

// executorch の getStructuredOutputPrompt をバイパスして同等のプロンプトを作る。
// 内部実装が `responseSchema instanceof zCore.$ZodType` を呼ぶが、zod 4 の RN
// ランタイムで `$ZodType` が undefined になりエラーになるため自前で組む。
export const getRecordSchemaPrompt = () => {
  const schemaString = JSON.stringify(RecordSchema)
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

const coerceNumber = (raw) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const n = parseFloat(raw)
    if (!Number.isNaN(n)) return n
  }
  return null
}

const parseFoodKind = (parsed) => {
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
  return { kind: 'food', items }
}

const parseWeightKind = (parsed) => {
  const weightKg = coerceNumber(parsed?.weight_kg)
  if (weightKg == null || weightKg <= 0 || weightKg > 500) {
    throw new Error('体重を抽出できませんでした')
  }
  return { kind: 'weight', weight_kg: weightKg }
}

const parseActivityKind = (parsed) => {
  // LLM が food の items パターンに引きずられて
  // {"kind":"activity","items":[{"activity_name":..,"duration_min":..}]} を返してきた場合の救済
  let p = parsed
  if (
    Array.isArray(p?.items) &&
    p.items.length > 0 &&
    p.items[0] &&
    typeof p.items[0] === 'object'
  ) {
    p = { ...p, ...p.items[0] }
  }
  const name =
    typeof p?.activity_name === 'string' ? p.activity_name.trim() : ''
  if (!name) throw new Error('種目を抽出できませんでした')

  const rawDur = coerceNumber(p?.duration_min)
  const rawDist = coerceNumber(p?.distance_km)
  // 異常値ははじく（0 や負、極端に大きい値）
  const durationMin =
    rawDur != null && rawDur > 0 && rawDur <= 1440 ? rawDur : null
  const distanceKm =
    rawDist != null && rawDist > 0 && rawDist <= 500 ? rawDist : null

  // 時間も距離もない場合は kcal 推定の手がかりがないので reject
  if (durationMin == null && distanceKm == null) {
    throw new Error('時間または距離が必要です')
  }
  return {
    kind: 'activity',
    activity_name: name,
    duration_min: durationMin,
    distance_km: distanceKm,
  }
}

// kind ごとに適切なフィールドを取り出して discriminated union を返す。
// モデルが {"items":[...]} だけを返した（kind が欠落した）場合は food として扱う互換挙動。
export const parseRecordOutput = (rawOutput) => {
  const extracted = extractBetweenBrackets(rawOutput)
  const repaired = jsonrepair(extracted)
  const parsed = JSON.parse(repaired)

  if (Array.isArray(parsed)) {
    return parseFoodKind({ items: parsed })
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON が見つかりません')
  }

  const kind = typeof parsed.kind === 'string' ? parsed.kind : null

  // 旧形式 ({"items":[...]} だけ) は食事として受け入れる
  if (!kind && Array.isArray(parsed.items)) {
    return parseFoodKind(parsed)
  }

  switch (kind) {
    case 'food':
      return parseFoodKind(parsed)
    case 'weight':
      return parseWeightKind(parsed)
    case 'activity':
      return parseActivityKind(parsed)
    case 'unknown':
      return { kind: 'unknown' }
    default:
      throw new Error(`未対応の kind: ${kind ?? '(なし)'}`)
  }
}

export const normalizePortion = (raw) => {
  if (!raw) return 'normal'
  if (raw.includes('大')) return 'large'
  if (raw.includes('少')) return 'small'
  return 'normal'
}
