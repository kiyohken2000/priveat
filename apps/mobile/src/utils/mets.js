// 運動の kcal 推定で使う MET (Metabolic Equivalent of Task) 辞書。
//
// 各エントリ:
//   met:       ACSM Compendium of Physical Activities (2011) の代表値
//   speed_kmh: 距離だけ書かれた入力 (例: "5km走った") を時間に換算するための想定速度。
//              null の種目 (筋トレ・水泳など) は距離入力では kcal 推定不可。
//
// kcal 推定式:
//   kcal = MET × weight_kg × hours × 1.05
// (1.05 は安静時代謝の補正係数で慣用値。短時間ならほぼ MET × kg × h と同じ)

const TABLE = {
  ウォーキング:     { met: 3.5,  speed_kmh: 4 },
  ランニング:       { met: 8.0,  speed_kmh: 9 },
  ジョギング:       { met: 6.0,  speed_kmh: 7 },
  サイクリング:     { met: 7.5,  speed_kmh: 18 },
  水泳:             { met: 7.0,  speed_kmh: null },
  筋トレ:           { met: 5.0,  speed_kmh: null },
  ヨガ:             { met: 2.5,  speed_kmh: null },
  ストレッチ:       { met: 2.3,  speed_kmh: null },
  テニス:           { met: 7.0,  speed_kmh: null },
  サッカー:         { met: 7.0,  speed_kmh: null },
  バスケットボール: { met: 6.5,  speed_kmh: null },
  登山:             { met: 6.0,  speed_kmh: 3 },
  ハイキング:       { met: 5.5,  speed_kmh: 4 },
  縄跳び:           { met: 11.0, speed_kmh: null },
  ダンス:           { met: 5.0,  speed_kmh: null },
  家事:             { met: 2.5,  speed_kmh: null },
}

// canonical 名へのフォールバック辞書。LLM が活用形のまま返した場合の保険。
const SYNONYMS = {
  ウォーキング:     ['歩く', '歩いた', '歩いて', '散歩', 'walk', 'walking'],
  ランニング:       ['走る', '走った', '走って', 'ラン', 'run', 'running'],
  ジョギング:       ['ジョグ', 'jog', 'jogging'],
  サイクリング:     ['自転車', '漕いだ', '漕ぐ', 'バイク', 'ロードバイク', 'bike', 'cycling'],
  水泳:             ['泳ぐ', '泳いだ', 'スイミング', 'swim', 'swimming'],
  筋トレ:           ['ウェイト', 'トレーニング', 'ジム', 'weight', 'workout'],
  ヨガ:             ['yoga'],
  ストレッチ:       ['stretch'],
  テニス:           ['tennis'],
  サッカー:         ['フットサル', 'soccer', 'football'],
  バスケットボール: ['バスケ', 'basketball'],
  登山:             ['山登り'],
  ハイキング:       ['hiking'],
  縄跳び:           ['ジャンプロープ', 'jumprope'],
  ダンス:           ['dance', 'ダンシング'],
  家事:             ['掃除', '料理', '炊事'],
}

const DEFAULT_ENTRY = { met: 4.0, speed_kmh: null } // 中程度の活動相当

export const DEFAULT_WEIGHT_KG = 60

// 種目名 → MET エントリ。完全一致 → 部分一致 → 同義語の順で探す。
// 見つからなければ null (呼び出し側で DEFAULT_ENTRY を当てる)。
export const findMetEntry = (rawName) => {
  if (!rawName) return null
  const key = String(rawName).trim()
  if (!key) return null
  if (TABLE[key]) return { name: key, ...TABLE[key] }
  for (const [canonical, entry] of Object.entries(TABLE)) {
    if (key.includes(canonical) || canonical.includes(key)) {
      return { name: canonical, ...entry }
    }
  }
  for (const [canonical, syns] of Object.entries(SYNONYMS)) {
    if (syns.some((s) => key.includes(s))) {
      return { name: canonical, ...TABLE[canonical] }
    }
  }
  return null
}

const round = (n) => Math.round(n)

// 活動量 → kcal 推定。
//   入力: activity_name, duration_min (任意), distance_km (任意), weight_kg
//   時間が無く距離があるなら、種目別の想定速度で時間に換算してから kcal を出す。
//   どちらも無い、または距離だけで速度未定義の種目 (筋トレ等) は kcal/duration とも null。
export const estimateActivityKcal = ({
  activity_name,
  duration_min,
  distance_km,
  weight_kg,
}) => {
  const found = findMetEntry(activity_name)
  const entry = found ?? { name: activity_name ?? '運動', ...DEFAULT_ENTRY }
  const w = weight_kg && weight_kg > 0 ? weight_kg : DEFAULT_WEIGHT_KG

  let dur = duration_min
  let durationSource = 'duration'
  if (dur == null || dur <= 0) {
    if (distance_km && distance_km > 0 && entry.speed_kmh) {
      dur = (distance_km / entry.speed_kmh) * 60
      durationSource = 'distance_to_duration'
    } else {
      return {
        kcal: null,
        duration_min: null,
        met: entry.met,
        canonical_name: entry.name,
        duration_source: null,
        weight_kg_used: w,
      }
    }
  }

  const hours = dur / 60
  const kcal = entry.met * w * hours * 1.05
  return {
    kcal: round(kcal),
    duration_min: round(dur * 10) / 10, // 小数1桁
    met: entry.met,
    canonical_name: entry.name,
    duration_source: durationSource,
    weight_kg_used: w,
  }
}
