import { initLlama } from 'llama.rn'
import {
  getLlamaRnTextModelPaths,
  isLlamaRnTextModelDownloaded,
} from '../services/llmTextModelStorage'

// テキスト用 llama.rn (GGUF) のオーケストレータ。
// VLM の state/vlmOrchestrator.js のテキスト版で、 mmproj を扱わない分シンプル。
//
// 流れ:
//   1) executorch を退避 (preventLlmLoad=true → useLLM が cleanup)
//   2) llama.rn 初期化 (GGUF のみ、 initMultimodal は呼ばない)
//   3) callback 内で llama.completion を呼ぶ
//   4) llama.rn 解放
//   5) executorch 復帰 (preventLlmLoad=false → useLLM が再ロード)
//
// なぜ排他するか:
//   iPhone の Metal Working Set (GPU が同時確保できるメモリ) は 2-3GB しかない。
//   executorch (~700MB-1GB) + llama.rn (~800MB) を並行ロードすると上限超過で
//   片方が落ちる / 推論失敗する。時間軸で完全分離する。
//   詳細: docs/PLAN_VLM_llama_rn.md §2 / vlmOrchestrator.js のコメント。

const SETTLE_MS = 400

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runWithLlamaRnText({ model, modelContext }, callback) {
  if (!model) {
    throw new Error('テキスト用 llama.rn モデルが指定されていません')
  }
  if (typeof modelContext?.setPreventLlmLoad !== 'function') {
    throw new Error('llmTextOrchestrator: modelContext.setPreventLlmLoad が必要です')
  }

  const downloaded = await isLlamaRnTextModelDownloaded(model)
  if (!downloaded) {
    throw new Error(
      `GGUF モデル「${model.label}」が未ダウンロードです。ベンチマーク画面で DL してください。`,
    )
  }

  const { mainPath } = getLlamaRnTextModelPaths(model)

  // 1) executorch をアンロード
  modelContext.setPreventLlmLoad(true)
  await sleep(SETTLE_MS)

  let llama = null
  try {
    // 2) llama.rn 初期化 (テキストオンリーなので initMultimodal は呼ばない)
    llama = await initLlama({
      model: mainPath,
      n_ctx: 4096,
      n_gpu_layers: 99, // iOS Metal フル使用 (CPU only にしたい場合は 0)
    })

    // 3) ユーザー callback (実際の completion)
    const result = await callback(llama)
    return result
  } finally {
    // 4) llama.rn 解放
    if (llama) {
      try {
        await llama.release()
      } catch (e) {
        // 既に release 済み等は無視
      }
    }
    await sleep(SETTLE_MS)
    // 5) executorch 復帰
    modelContext.setPreventLlmLoad(false)
  }
}
