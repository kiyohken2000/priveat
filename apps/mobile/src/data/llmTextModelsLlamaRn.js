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
    label: 'LFM2.5 1.2B JP',
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
  // ---- Gemma 3 系 (QAT 由来 GGUF、 ベンチマーク追加用 #167 で採用) -------------
  // QAT = Quantization Aware Training。 Google が量子化を意識して学習した bf16 から
  // GGUF を作っているため、 同サイズの普通の Q4 量子化より品質保持が良い。
  // 注意: Google org の Gemma リポジトリは HF gated (利用許諾必要) なので、
  // 認証なしで DL するため community 配布 (bartowski) を使う。 元となる QAT bf16 は
  // Google 公式なので品質は公式 QAT と同等。
  //
  // 採用理由 (parser 用途): ベンチで「カツ丼 1杯 大盛り」のような分量ニュアンス検出が
  // LFM2.5-JP より詳細だった (estimated_kcal にも反映される)。 低スペック端末で LFM2.5 が
  // 動かない / 遅い場合の選択肢。
  // 非採用 (coach 用途): 日本語の自然さが LFM2.5-JP より明確に劣る (「ランニングをしっかり摂り」
  // のような不自然表現や「頑張って」連発)。 coach には LFM2.5-JP を使うべき。
  // Gemma 4 E2B も検討したが、 thinking mode で n_predict を食い潰して JSON/応答が出ない
  // 上に推論が 4-5 倍遅く採用見送り。 別途 thinking off で追試する余地はある。
  //
  // 2026-06 追記: react-native-executorch v0.9.1 で Gemma 4 がネイティブ対応された
  // (定数 GEMMA4_E2B / GEMMA4_E2B_MM)。 iOS は MLX (GPU/ANE) バックエンドが効くため、
  // llama.rn (CPU) で見た「4-5x 遅い」問題が解消する可能性が高い。 ただし:
  //   - parser 用途: 2.3B effective だが、 短い JP → JSON 抽出というナローな仕事で
  //     Gemma 3 1B / LFM2.5-JP からの伸びは限定的。 thinking mode が executorch 側で
  //     どう扱われるか要検証 (採用判断のクリティカルパス)。
  //   - coach 用途: Gemma は多言語汎用なので JP 自然さは LFM2.5-JP (1.2B JP 特化) を
  //     抜きにくい (1B JP 特化 > 2.3B 多言語 はこの規模では普通に起こる)。
  //   - 真の勝ち目はマルチモーダル版 GEMMA4_E2B_MM (画像 + 音声)。 これは VLM 側の
  //     置き換え候補として data/llmModelsVlm.js で別途検討すべき (本ファイルの対象外)。
  // 結論: 本ファイル (llama.rn 経由 GGUF) に Gemma 4 を追加するメリットは薄い。
  // 試すなら executorch 経由 (data/llmModels.js 側) で GEMMA4_E2B を登録するのが筋。
  // 参考: unsloth/gemma-4-E2B-it-qat-GGUF (Q4_K_XL 2.62GB / Q2_K_XL 2.19GB) が
  // QAT 由来で配布されているが、 iPhone 13 mini (RAM 4GB) では OOM リスクが高い。
  {
    id: 'gemma-3-1b-it-qat-q4',
    label: 'Gemma 3 1B Instruct',
    description:
      '超軽量 1B (~806MB)。Google QAT を bartowski が Q4_K_M に量子化。 低スペック端末向け parser 候補 (coach 用途は LFM2.5-JP 推奨)。',
    badge: 'Gemma',
    family: 'Gemma3',
    kind: 'text',
    engine: 'llama_rn',
    minDeviceRamBytes: RAM_TIER.TIER_4GB,
    main: {
      url: 'https://huggingface.co/bartowski/google_gemma-3-1b-it-qat-GGUF/resolve/main/google_gemma-3-1b-it-qat-Q4_K_M.gguf',
      // HF 表示の 806 MB を目安値として置く (実値は初回 DL 時の Content-Length で確定)
      sizeBytes: 845_135_872,
    },
  },
]

export const getLlamaRnTextModelById = (id) =>
  LLM_LLAMA_RN_TEXT_MODELS.find((m) => m.id === id) ?? null
