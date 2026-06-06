// 「食品名 + 単位」→ 1単位あたりのグラム数。
// g 単位以外で送られた量を kcal 計算可能にするためのテーブル。
//
// 値は普段の感覚に近い目安。厳密さよりも実用性優先。
// マッチング: lookupPortion(name, unit) は name の完全一致を期待。

export const PORTION_WEIGHTS = {
  // 米・主食
  ごはん: { 杯: 150, 茶碗: 150, 椀: 150, 個: 150 },
  ご飯: { 杯: 150, 茶碗: 150, 椀: 150 },
  白米: { 杯: 150, 茶碗: 150 },
  玄米: { 杯: 150, 茶碗: 150 },
  おにぎり: { 個: 100, 本: 100 },

  // パン
  食パン: { 枚: 60 }, // 6枚切り想定。8枚切りなら45g
  パン: { 枚: 60, 個: 60 },
  トースト: { 枚: 60 },
  クロワッサン: { 個: 50 },
  ベーグル: { 個: 100 },

  // 麺類（ゆで後）
  うどん: { 玉: 250, 杯: 250, 人前: 250 },
  そば: { 玉: 200, 杯: 200, 人前: 200 },
  ラーメン: { 杯: 250, 人前: 250 },
  中華めん: { 玉: 200, 杯: 200 },
  パスタ: { 人前: 200, 皿: 200 },
  スパゲッティ: { 人前: 200, 皿: 200 },

  // 卵
  卵: { 個: 50, 玉: 50 },
  たまご: { 個: 50, 玉: 50 },
  ゆで卵: { 個: 50, 玉: 50 },
  ゆでたまご: { 個: 50, 玉: 50 },
  目玉焼き: { 個: 60 },
  生卵: { 個: 50 },

  // 果物
  バナナ: { 本: 100 },
  りんご: { 個: 250 },
  リンゴ: { 個: 250 },
  みかん: { 個: 80 },
  ミカン: { 個: 80 },

  // 飲み物
  牛乳: { 杯: 200, 本: 200, 缶: 200 },
  ヨーグルト: { 個: 100, 杯: 100 },
  プレーンヨーグルト: { 個: 100, 杯: 100 },
  ビール: { 本: 350, 缶: 350, 杯: 350 },
  缶ビール: { 本: 350, 缶: 350 },
  チューハイ: { 本: 350, 缶: 350 },
  缶チューハイ: { 本: 350, 缶: 350 },
  コーヒー: { 杯: 150, 本: 250 },
  紅茶: { 杯: 150 },
  お茶: { 杯: 150, 本: 500 },

  // その他
  豆腐: { 丁: 300, 個: 150, 杯: 150, パック: 150 },
  納豆: { パック: 50, 個: 50 },
  みそ汁: { 杯: 200, 椀: 200 },
}

// 「リットル」「ミリリットル」など単位の表記揺れ吸収
const UNIT_ALIASES = {
  個: ['個', '玉', 'こ'],
  本: ['本', 'ぽん', 'ほん'],
  杯: ['杯', 'ぱい', 'はい'],
  枚: ['枚', 'まい'],
  缶: ['缶', 'かん'],
}

const normalizeUnit = (unit) => {
  const u = String(unit ?? '').trim()
  for (const [canonical, variants] of Object.entries(UNIT_ALIASES)) {
    if (variants.includes(u)) return canonical
  }
  return u
}

export const lookupPortion = (name, unit) => {
  if (!name || !unit) return null
  const map = PORTION_WEIGHTS[String(name).trim()]
  if (!map) return null
  // 完全一致 or 正規化一致
  if (map[unit] != null) return map[unit]
  const canon = normalizeUnit(unit)
  if (map[canon] != null) return map[canon]
  return null
}

// 食品名から既定単位を推定する。
//   - PORTION_WEIGHTS に登録があれば最初のキー (= 最も自然な単位) を返す
//     ※ JS オブジェクトの挿入順序が「自然な単位」になるよう PORTION_WEIGHTS を並べておく
//   - 無ければ null
// kcal 計算ではなく「入力欄の単位サジェスト」用なので、ヒットしないことも許容する。
export const defaultUnitForName = (name) => {
  if (!name) return null
  const map = PORTION_WEIGHTS[String(name).trim()]
  if (!map) return null
  const keys = Object.keys(map)
  return keys.length > 0 ? keys[0] : null
}
