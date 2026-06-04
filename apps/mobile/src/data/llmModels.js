import {
  QWEN3_0_6B_QUANTIZED,
  QWEN3_1_7B_QUANTIZED,
  QWEN3_4B_QUANTIZED,
} from 'react-native-executorch'

// 日本語が安定する Qwen3 量子化版に絞ったカタログ。
// 各エントリの id は AsyncStorage に保存するキーになるので、変えると既存ユーザーの選択が
// 飛ぶ点に注意（v1 では問題なし）。
// approxSizeMb は UI 表示用の目安値。executorch がダウンロードする実ファイルサイズと
// 完全一致するとは限らない。

export const LLM_MODELS = [
  {
    id: 'qwen3-0.6b-q',
    label: 'Qwen3 0.6B (量子化)',
    description: '軽量・高速。古い端末でも動く。',
    badge: '軽量',
    approxSizeMb: 400,
    source: QWEN3_0_6B_QUANTIZED,
  },
  {
    id: 'qwen3-1.7b-q',
    label: 'Qwen3 1.7B (量子化)',
    description: 'バランス型。日本語の安定度が上がる。',
    badge: 'バランス',
    approxSizeMb: 1200,
    source: QWEN3_1_7B_QUANTIZED,
  },
  {
    id: 'qwen3-4b-q',
    label: 'Qwen3 4B (量子化)',
    description: '高品質。重い端末では遅くなる。',
    badge: '高品質',
    approxSizeMb: 3000,
    source: QWEN3_4B_QUANTIZED,
  },
]

export const DEFAULT_MODEL_ID = 'qwen3-0.6b-q'

export const getModelById = (id) =>
  LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0]
