import { RAM_TIER } from '../utils/deviceRam'

// llama.rn 経由で動かすテキスト用 LLM (GGUF) のメタデータ。
// executorch (`useLLM`) で動く LLM_MODELS とは別管理する理由:
//   - 推論エンジンが llama.rn (llama.cpp バインディング) と異なる
//   - GGUF 単一ファイル構成 (executorch の {modelSource, tokenizer, config} 3 点セットと違う)
//   - DL 経路も expo-file-system 直接 (VLM と同じ仕組み、 services/llmTextModelStorage.js)
//
// 用途 (β):
//   - 現状はベンチマーク画面 (設定 > モデル比較 (β)) で「LFM2.5-1.2B-JP の素の日本語精度」を
//     測るためだけに使う。本番の Chat (parser/coach) は引き続き executorch。
//   - 多言語版 (executorch 経由) との並列比較で、日本語特化版に投資する価値があるかを判定する。
//
// kind: 'text' は将来 ModelScreen に統合するときの識別子。今はベンチマーク画面でしか使わない。

export const LLM_LLAMA_RN_TEXT_MODELS = [
  {
    id: 'lfm2.5-1.2b-jp-q4',
    label: 'LFM2.5 1.2B JP (GGUF Q4_K_M)',
    description:
      '日本語特化 1.2B (~731MB)。Liquid AI が日本語向けに追加学習した版を llama.rn で実行。executorch 多言語版との比較用。',
    badge: 'JP',
    family: 'LFM2.5',
    kind: 'text',
    engine: 'llama_rn',
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    main: {
      url: 'https://huggingface.co/LiquidAI/LFM2.5-1.2B-JP-GGUF/resolve/main/LFM2.5-1.2B-JP-Q4_K_M.gguf',
      // HF 表示の 731 MB をバイト換算した目安値 (実値は初回 DL 時の Content-Length で確定)
      sizeBytes: 766_410_752,
    },
  },
]

export const getLlamaRnTextModelById = (id) =>
  LLM_LLAMA_RN_TEXT_MODELS.find((m) => m.id === id) ?? null
