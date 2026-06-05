// マスコットキャラクター「にもにゃん」の Lottie アニメーション。
//
// Metro バンドラは静的な require() しか追跡できないため、各ファイルを明示的に列挙する。
// 表情の対応関係 (どれが笑顔/驚き/etc) は把握していないので、ランダムではなく
// 「日付ハッシュ → 安定インデックス」で選ぶ。同じ日に再描画しても顔が変わらない。

const NIMONYAN = [
  require('../../assets/lottie/nimonyan/nimonyan0001.json'),
  require('../../assets/lottie/nimonyan/nimonyan0002.json'),
  require('../../assets/lottie/nimonyan/nimonyan0003.json'),
  require('../../assets/lottie/nimonyan/nimonyan0004.json'),
  require('../../assets/lottie/nimonyan/nimonyan0005.json'),
  require('../../assets/lottie/nimonyan/nimonyan0006.json'),
  require('../../assets/lottie/nimonyan/nimonyan0007.json'),
  require('../../assets/lottie/nimonyan/nimonyan0008.json'),
  require('../../assets/lottie/nimonyan/nimonyan0009.json'),
  require('../../assets/lottie/nimonyan/nimonyan0010.json'),
  require('../../assets/lottie/nimonyan/nimonyan0011.json'),
  require('../../assets/lottie/nimonyan/nimonyan0012.json'),
  require('../../assets/lottie/nimonyan/nimonyan0013.json'),
  require('../../assets/lottie/nimonyan/nimonyan0014.json'),
  require('../../assets/lottie/nimonyan/nimonyan0015.json'),
  require('../../assets/lottie/nimonyan/nimonyan0016.json'),
  require('../../assets/lottie/nimonyan/nimonyan0017.json'),
  require('../../assets/lottie/nimonyan/nimonyan0018.json'),
  require('../../assets/lottie/nimonyan/nimonyan0019.json'),
  require('../../assets/lottie/nimonyan/nimonyan0020.json'),
  require('../../assets/lottie/nimonyan/nimonyan0021.json'),
]

// 文字列の単純なハッシュ (FNV-1a 32bit 相当の軽量版)。負値を避けるため >>> 0 で uint 化。
// 用途上、暗号学的強度は不要で「同じ入力で同じ出力」と「分布の偏りが目立たない」だけ満たせばよい。
const hashString = (s) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h
}

// 日付文字列 ('YYYY-MM-DD') を入力にマスコットを 1 体選ぶ。
// 引数なしのときは現在時刻 (ミリ秒) で都度ランダム。
export const pickMascotForDate = (date) => {
  const key = date || String(Date.now())
  const idx = hashString(key) % NIMONYAN.length
  return NIMONYAN[idx]
}

export const mascotCount = NIMONYAN.length
