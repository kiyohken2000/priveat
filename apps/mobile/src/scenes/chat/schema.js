import { jsonrepair } from 'jsonrepair'

// multi-intent パーサー出力スキーマ。
//   kind に応じて使うフィールドが変わる discriminated union。
//   food     → items
//   recipe   → name, servings, ingredients (自炊レシピのまとめ作り登録)
//   weight   → weight_kg
//   activity → activity_name, duration_min
//   unknown  → kind のみ
export const RecordSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['food', 'recipe', 'weight', 'activity', 'unknown'],
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
          estimated_kcal: {
            type: 'number',
            description: 'この品目1食分の常識的なカロリー目安 (整数、任意)。食品DBに無いときのフォールバック用',
          },
        },
        required: ['name', 'quantity', 'unit'],
      },
    },
    name: { type: 'string', description: 'kind=recipe のときの料理名 (例: カレー)' },
    servings: { type: 'number', description: 'kind=recipe のときの食数 (例: 5食分なら 5)' },
    ingredients: {
      type: 'array',
      description: 'kind=recipe のときの材料リスト',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '材料名' },
          quantity: { type: 'number', description: '材料の数量' },
          unit: { type: 'string', description: '材料の単位 (g/個/本/缶 等)' },
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
  const start = text.indexOf(opening)
  const end = text.lastIndexOf(closing)
  // 閉じブラケットが無い (LLM が生成上限で途中で切れた) ケースは
  // 末尾までを返して後段の jsonrepair に救済を任せる。 末尾品目が
  // 落ちる可能性はあるが、 先頭品目だけでも記録できる方が体験として良い。
  if (end < start) return text.slice(start)
  return text.slice(start, end + 1)
}

// 末尾判定 / 括弧バランス判定のノイズになる markdown コードフェンスを除去。
//   - ```json\n...\n``` / ```\n...\n``` / 末端だけ ``` などのパターン
//   - 多くの LLM が JSON を ```json ... ``` で囲って返してくるため、 これを
//     除去しないと正常出力でも末尾が ``` になり truncated 誤判定になる。
const stripCodeFences = (text) => {
  let s = String(text ?? '').trim()
  s = s.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '')
  s = s.replace(/\r?\n?[ \t]*```[ \t]*$/, '')
  return s.trim()
}

// LLM 出力が生成上限などで途中で切れているかを推定する。
//   - JSON 末尾が } や ] で閉じておらず、最後の文字が , : " などで終わっている
//   - 開きと閉じの括弧の数が合わない
// jsonrepair で形式上は parse 可能になっても、items の末尾品目が
// 落ちている可能性があるためカードに警告を出すフラグとして使う。
const detectTruncated = (rawOutput) => {
  const trimmed = String(rawOutput ?? '').trim()
  if (!trimmed) return false
  // <think> ブロックは末尾判定のノイズになるので外す
  const noThink = trimmed.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!noThink) return false
  // markdown コードフェンスも外す (```json ... ``` で囲って返すモデルが多い)
  const noFence = stripCodeFences(noThink)
  if (!noFence) return false
  const last = noFence[noFence.length - 1]
  if (last !== '}' && last !== ']') return true
  // 括弧バランス (文字列リテラル中は無視)
  let inStr = false
  let escape = false
  let braces = 0
  let brackets = 0
  for (let i = 0; i < noFence.length; i += 1) {
    const c = noFence[i]
    if (escape) {
      escape = false
      continue
    }
    if (c === '\\') {
      escape = true
      continue
    }
    if (c === '"') {
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (c === '{') braces += 1
    else if (c === '}') braces -= 1
    else if (c === '[') brackets += 1
    else if (c === ']') brackets -= 1
  }
  return braces !== 0 || brackets !== 0
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

// qwen3-0.6b 等の小型モデルが items 配列の中にもう一段 {kind:'food', items:[...]}
// を入れ子で返してくるケースの救済。 「name を持たず items 配列を持つ要素」 を
// ラッパーと見なして中身を展開する。 正常な item は name を持つので影響なし。
const flattenWrappedItems = (arr, depth = 0) => {
  if (depth > 3) return arr
  return arr.flatMap((it) => {
    if (it && typeof it === 'object' && !it.name && Array.isArray(it.items)) {
      return flattenWrappedItems(it.items, depth + 1)
    }
    return [it]
  })
}

const parseFoodKind = (parsed) => {
  const rawItemsArray = Array.isArray(parsed) ? parsed : parsed?.items
  if (!Array.isArray(rawItemsArray)) {
    throw new Error('items 配列が見つかりません')
  }
  const itemsArray = flattenWrappedItems(rawItemsArray)
  const items = itemsArray
    .map((it) => {
      if (!it || typeof it !== 'object') return null
      const name = coerceName(it.name)
      if (!name) return null
      const estimated = coerceNumber(it.estimated_kcal)
      // 異常値はじき: 0〜2000 kcal の範囲内のみ採用
      const estimatedKcal =
        estimated != null && estimated > 0 && estimated <= 2000 ? Math.round(estimated) : null
      return {
        name,
        quantity: coerceQuantity(it.quantity) ?? 1,
        unit: coerceUnit(it.unit) ?? '人前',
        portion: typeof it.portion === 'string' ? it.portion : undefined,
        estimated_kcal: estimatedKcal,
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

const parseRecipeKind = (parsed) => {
  const name = typeof parsed?.name === 'string' ? parsed.name.trim() : ''
  if (!name) throw new Error('レシピ名を抽出できませんでした')
  const servings = coerceNumber(parsed?.servings)
  if (servings == null || servings <= 0 || servings > 50) {
    throw new Error('食数を抽出できませんでした')
  }
  const ingredientsArray = Array.isArray(parsed?.ingredients) ? parsed.ingredients : []
  const ingredients = ingredientsArray
    .map((it) => {
      if (!it || typeof it !== 'object') return null
      const iname = coerceName(it.name)
      if (!iname) return null
      return {
        name: iname,
        quantity: coerceQuantity(it.quantity) ?? 1,
        unit: coerceUnit(it.unit) ?? 'g',
      }
    })
    .filter(Boolean)
  if (ingredients.length === 0) {
    throw new Error('材料を抽出できませんでした')
  }
  return { kind: 'recipe', name, servings, ingredients }
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

// 失敗時にどのステージで詰まったか分かるよう、中間結果を Error に貼っておく。
//   - parseAndDispatch 側でログに [extracted] / [repaired] として出して
//     LLM 出力のどこで JSON が壊れているか切り分けできるようにする。
const attachStages = (err, stages) => {
  if (err && typeof err === 'object') {
    const patch = {}
    if (stages.extracted !== undefined) patch.extracted = stages.extracted
    if (stages.repaired !== undefined) patch.repaired = stages.repaired
    if (stages.parsed !== undefined) patch.parsed = stages.parsed
    Object.assign(err, patch)
  }
  return err
}

// kind ごとに適切なフィールドを取り出して discriminated union を返す。
// モデルが {"items":[...]} だけを返した（kind が欠落した）場合は food として扱う互換挙動。
// 出力が生成上限で切れていそうなら結果に truncated=true を載せる。
export const parseRecordOutput = (rawOutput) => {
  const truncated = detectTruncated(rawOutput)
  let extracted
  try {
    extracted = extractBetweenBrackets(rawOutput)
  } catch (e) {
    throw attachStages(e, {})
  }
  let repaired
  try {
    repaired = jsonrepair(extracted)
  } catch (e) {
    throw attachStages(e, { extracted })
  }
  let parsed
  try {
    parsed = JSON.parse(repaired)
  } catch (e) {
    throw attachStages(e, { extracted, repaired })
  }

  const withTruncated = (result) =>
    truncated ? { ...result, truncated: true } : result

  // kind 判定以降で投げられる Error にも extracted/repaired/parsed を貼って
  // 「JSON は通ったが kind 判定 / フィールド抽出で落ちた」ケースを切り分け可能にする。
  try {
    if (Array.isArray(parsed)) {
      return withTruncated(parseFoodKind({ items: parsed }))
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('JSON が見つかりません')
    }

    const kind = typeof parsed.kind === 'string' ? parsed.kind : null

    // 旧形式 ({"items":[...]} だけ) は食事として受け入れる
    if (!kind && Array.isArray(parsed.items)) {
      return withTruncated(parseFoodKind(parsed))
    }

    switch (kind) {
      case 'food':
        return withTruncated(parseFoodKind(parsed))
      case 'recipe':
        return withTruncated(parseRecipeKind(parsed))
      case 'weight':
        return parseWeightKind(parsed)
      case 'activity':
        return parseActivityKind(parsed)
      case 'unknown':
        // LFM2.5 等が分類自信なしで kind=unknown を選びつつ items を埋めて
        // 返してくるケースがある。 有効な品目が入っているなら food として救済。
        if (Array.isArray(parsed.items) && parsed.items.length > 0) {
          try {
            return withTruncated(parseFoodKind(parsed))
          } catch (e) {
            // items が腐っていたら本来の unknown に落とす
          }
        }
        return { kind: 'unknown' }
      default:
        throw new Error(`未対応の kind: ${kind ?? '(なし)'}`)
    }
  } catch (e) {
    throw attachStages(e, { extracted, repaired, parsed })
  }
}

export const normalizePortion = (raw) => {
  if (!raw) return 'normal'
  if (raw.includes('大')) return 'large'
  if (raw.includes('少')) return 'small'
  return 'normal'
}
