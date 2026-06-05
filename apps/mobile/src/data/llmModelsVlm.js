import { RAM_TIER } from '../utils/deviceRam'

// VLM (vision-language model) のメタデータ。
// executorch 用の LLM_MODELS (data/llmModels.js) とは別管理する理由:
//   - 推論エンジンが llama.rn (llama.cpp バインディング) と異なる
//   - main GGUF + mmproj GGUF の 2 ファイル構成 (executorch の
//     {modelSource, tokenizer, config} とは構造が違う)
//   - DL 経路も expo-file-system 直接で違う
// kind: 'vision' は ModelScreen の「写真」タブで使う識別子。
//
// HuggingFace の resolve URL は executorch 同様に固定タグ付きの方が安全だが、
// 公式リポジトリは breaking change なしの運用なので main 固定で OK。
// sizeBytes は 2026-06 時点で HEAD リクエストで確認した実値。

export const VLM_MODELS = [
  {
    id: 'smolvlm-500m-q8',
    label: 'SmolVLM 500M (量子化)',
    description: '軽量・高速。低スペック端末でも動く。料理認識の精度はそれなり。',
    badge: '軽量',
    family: 'SmolVLM',
    kind: 'vision',
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    main: {
      url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf',
      sizeBytes: 436806912,
    },
    mmproj: {
      url: 'https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf',
      sizeBytes: 108783360,
    },
  },
  {
    id: 'qwen3-vl-2b-q4',
    label: 'Qwen3-VL 2B (量子化)',
    description: '中量。日本語料理認識で実用ラインに乗りやすい。高スペック端末向け。',
    badge: 'バランス',
    family: 'Qwen3-VL',
    kind: 'vision',
    minDeviceRamBytes: RAM_TIER.TIER_6GB,
    main: {
      url: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf',
      sizeBytes: 1107409952,
    },
    mmproj: {
      url: 'https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf',
      sizeBytes: 445053216,
    },
  },
]

export const DEFAULT_VLM_MODEL_ID = 'smolvlm-500m-q8'

export const getVlmModelById = (id) =>
  VLM_MODELS.find((m) => m.id === id) ?? VLM_MODELS[0]

export const totalVlmModelSizeBytes = (model) =>
  (model?.main?.sizeBytes ?? 0) + (model?.mmproj?.sizeBytes ?? 0)
