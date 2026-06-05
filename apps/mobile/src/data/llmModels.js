import {
  LFM2_5_1_2B_INSTRUCT_QUANTIZED,
  LFM2_5_350M_QUANTIZED,
  QWEN3_0_6B_QUANTIZED,
  QWEN3_1_7B_QUANTIZED,
  QWEN3_4B_QUANTIZED,
  QWEN3_5_0_8B_QUANTIZED,
  QWEN3_5_2B_QUANTIZED,
} from 'react-native-executorch'
import { RAM_TIER } from '../utils/deviceRam'

// 各モデルの id は AsyncStorage に保存するキーになるので、変えると既存ユーザーの選択が
// 飛ぶ点に注意。
// approxSizeMb は UI 表示用の目安値（executorch が DL する実ファイルサイズと完全一致
// するとは限らない）。
// minDeviceRamBytes は「このモデルを安全に走らせるのに必要な物理 RAM の目安」。
// 端末 RAM がこの値未満なら ModelScreen 側でグレーアウト＋警告を出す。
//   - 軽量モデル (~500MB): TIER_4GB
//   - 中量モデル (~1.2GB):  TIER_6GB
//   - 大型モデル (~2GB+):   TIER_8GB

export const LLM_MODELS = [
  // ---- Qwen3 系（既存。日本語の安定度が高い） --------------------------------
  {
    id: 'qwen3-0.6b-q',
    label: 'Qwen3 0.6B (量子化)',
    description: '軽量・高速。古い端末でも動く。',
    badge: '軽量',
    family: 'Qwen3',
    approxSizeMb: 400,
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    source: QWEN3_0_6B_QUANTIZED,
  },
  {
    id: 'qwen3-1.7b-q',
    label: 'Qwen3 1.7B (量子化)',
    description: 'バランス型。日本語の安定度が上がる。',
    badge: 'バランス',
    family: 'Qwen3',
    approxSizeMb: 1200,
    minDeviceRamBytes: RAM_TIER.TIER_6GB,
    source: QWEN3_1_7B_QUANTIZED,
  },
  {
    id: 'qwen3-4b-q',
    label: 'Qwen3 4B (量子化)',
    description: '高品質。重い端末では遅くなる。',
    badge: '高品質',
    family: 'Qwen3',
    approxSizeMb: 3000,
    minDeviceRamBytes: RAM_TIER.TIER_8GB,
    source: QWEN3_4B_QUANTIZED,
  },

  // ---- Qwen3.5 系（新規。Qwen3 の後継。多言語性能が改善） --------------------
  {
    id: 'qwen3.5-0.8b-q',
    label: 'Qwen3.5 0.8B (量子化)',
    description: 'Qwen3 の後継。軽量で多言語に強い。',
    badge: '軽量',
    family: 'Qwen3.5',
    approxSizeMb: 500,
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    source: QWEN3_5_0_8B_QUANTIZED,
  },
  {
    id: 'qwen3.5-2b-q',
    label: 'Qwen3.5 2B (量子化)',
    description: 'Qwen3.5 の中量級。日本語コーチ用途に向く。',
    badge: 'バランス',
    family: 'Qwen3.5',
    approxSizeMb: 1300,
    minDeviceRamBytes: RAM_TIER.TIER_6GB,
    source: QWEN3_5_2B_QUANTIZED,
  },

  // ---- LFM2.5 系（新規。Liquid AI。スループット重視） -------------------------
  {
    id: 'lfm2.5-350m-q',
    label: 'LFM2.5 350M (量子化)',
    description: '超軽量・高スループット。短い応答向け。',
    badge: '超軽量',
    family: 'LFM2.5',
    approxSizeMb: 250,
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    source: LFM2_5_350M_QUANTIZED,
  },
  {
    id: 'lfm2.5-1.2b-q',
    label: 'LFM2.5 1.2B Instruct (量子化)',
    description: '中量級。応答の安定度と速度のバランス。',
    badge: 'バランス',
    family: 'LFM2.5',
    approxSizeMb: 900,
    minDeviceRamBytes: RAM_TIER.TIER_6GB,
    source: LFM2_5_1_2B_INSTRUCT_QUANTIZED,
  },
]

export const DEFAULT_MODEL_ID = 'qwen3-0.6b-q'

export const getModelById = (id) =>
  LLM_MODELS.find((m) => m.id === id) ?? LLM_MODELS[0]
