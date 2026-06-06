// OCR 結果テキストを「食品ラベル / フィットネス / 体重」のいずれかに振り分けて構造化する。

// === 食品ラベル ===
// 日本の食品表示法に基づく標準フォーマット:
//   栄養成分表示 (XXX あたり)
//   エネルギー    XXX kcal
//   たんぱく質    X.X g
//   脂質          X.X g
//   炭水化物      X.X g
//   食塩相当量    X.X g
//
// OCR の典型的な誤読:
//   - "g" が "8" に化ける ("2.3g" → "2.3 8" や "2.38")
//   - 末尾の "g" が完全に消える ("16.5g" → "16.5")
//   - メーカー名・原材料表示は文字化けしがち（無視で OK）
export const parseLabelText = (text) => {
  if (!text) return null
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // 日本の食品表示法は kcal を小文字で表記する慣例。フィットネスアプリは大文字 KCAL なので
  // case-sensitive にすることでスクショ系を弾く。
  const kcalLineIdx = lines.findIndex((l) => /\d+(?:\.\d+)?\s*kcal\b/.test(l))
  if (kcalLineIdx < 0) return null

  const kcalMatch = lines[kcalLineIdx].match(/(\d+(?:\.\d+)?)\s*kcal\b/)
  if (!kcalMatch) return null
  const kcal = parseFloat(kcalMatch[1])

  // kcal 行の後から数値を順に拾う。たんぱく質→脂質→炭水化物→食塩相当量 の順前提。
  const macros = []
  for (let i = kcalLineIdx + 1; i < Math.min(kcalLineIdx + 12, lines.length); i += 1) {
    if (macros.length >= 4) break
    const line = lines[i]
    // 明らかなノイズはスキップ（電話番号、URL、製造者連絡先）
    // ノイズ排除（小文字 kcal の行は kcalLine 自身なので来ないはずだが念のため）
    if (/0120|tel|http|www/i.test(line)) continue
    if (/kcal/.test(line)) continue
    if (/\d{3,}-\d/.test(line)) continue
    // 数値だけの行 or 数値+g/8 の行をマッチ
    const m = line.match(/^(\d+(?:\.\d+)?)\s*[g8]?\s*$/i)
    if (!m) continue
    const raw = m[1]
    let n = parseFloat(raw)
    // ヒューリスティック: "5.18" のように2桁目が 8/0 で終わるなら OCR の g 誤読の可能性
    const trail = raw.match(/^(\d+\.\d)([08])$/)
    if (trail) n = parseFloat(trail[1])
    // 栄養成分は 0〜200 程度で妥当性チェック
    if (n >= 0 && n <= 200) macros.push(n)
  }

  return {
    kind: 'label',
    kcal,
    protein: macros[0] ?? null,
    fat: macros[1] ?? null,
    carb: macros[2] ?? null,
    salt: macros[3] ?? null,
  }
}

// === フィットネスアプリ（Apple Fitness 想定）===
// 典型: "619/260 KCAL", "10,859" (歩数), "9.01KM"
export const parseFitnessText = (text) => {
  if (!text) return null

  // レシート / 注文履歴系 (マック公式アプリ、ウーバーイーツ、コンビニ等) を弾く。
  // 「¥1,080」を 1,080 歩と誤検出するのを防ぐ。
  if (/[¥￥]|合計|小計|注文|ご注文|レシート|お会計/.test(text)) return null

  // 大文字 KCAL は Apple Fitness など運動アプリ系の表記
  const kcalMatch = text.match(/(\d+)(?:\s*\/\s*\d+)?\s*KCAL\b/)
  const activeKcal = kcalMatch ? parseInt(kcalMatch[1], 10) : null

  // 距離: "X.XX KM"（最初に出てくるものを採用）
  const distMatch = text.match(/(\d+\.\d+)\s*KM\b/i)
  const distance = distMatch ? parseFloat(distMatch[1]) : null

  // 歩数: カンマ区切り or 4〜6桁の生数値（5桁優先）
  let steps = null
  const stepsWithComma = text.match(/\b(\d{1,3}(?:,\d{3})+)\b/)
  if (stepsWithComma) {
    steps = parseInt(stepsWithComma[1].replace(/,/g, ''), 10)
  }

  if (activeKcal == null && distance == null && steps == null) return null
  return { kind: 'fitness', activeKcal, distance, steps }
}

// === 体重管理アプリ ===
// "54.30 kg" のような行が1〜複数現れる。
export const parseWeightText = (text) => {
  if (!text) return null
  const matches = [...text.matchAll(/(\d{2,3}\.\d{1,2})\s*kg\b/gi)]
  const weights = matches
    .map((m) => parseFloat(m[1]))
    .filter((w) => w >= 20 && w <= 250) // 妥当な人間体重
  if (weights.length === 0) return null
  return {
    kind: 'weight',
    weights,
    latest: weights[0], // 大抵スクショの最上段が最新
  }
}

// 順番に試して最初にヒットしたものを返す。
//   label を最優先（栄養成分表は最も構造化されている）
//   次に weight（kg 行が確実）
//   最後に fitness（最も曖昧）
export const detectAndParse = (text) => {
  const label = parseLabelText(text)
  if (label && label.kcal != null && label.protein != null) return label

  const weight = parseWeightText(text)
  if (weight) return weight

  const fitness = parseFitnessText(text)
  if (fitness) return fitness

  return { kind: 'unknown' }
}
