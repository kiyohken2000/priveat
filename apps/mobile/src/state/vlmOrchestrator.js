import { initLlama } from 'llama.rn'
import { getVlmModelPaths, isVlmModelDownloaded } from '../services/vlmModelStorage'

// 「executorch を退避 → llama.rn 初期化 → callback → llama.rn 解放 → executorch 復帰」
// の排他制御を行うオーケストレータ。Chat 側 (handlePhotoForVision) から呼ぶ。
//
// 設計参照: docs/PLAN_VLM_llama_rn.md §2 (2 エンジン同居方式)
//          及び votepurchase 記事「2エンジン同居問題: Metal Working Set との戦い」
//          https://qiita.com/votepurchase/items/0f24d056b5c252699a79
//
// なぜ排他するか:
//   iPhone の Metal Working Set (GPU が同時に確保できるメモリ) は 2-3GB しかない。
//   executorch (~700MB) + llama.rn (~1.5GB) を並行ロードすると上限超過で
//   片方が落ちる / 推論失敗する。時間軸で完全分離する。
//
// 使い方:
//   const modelContext = useActiveModel()
//   const result = await runWithLlamaRn(
//     { model: visionModel, modelContext },
//     async (llama) => {
//       const res = await llama.completion({ messages, n_predict: 256 })
//       return res.text
//     },
//   )
//
// callback 内で投げた例外は finally で executorch を必ず復帰させた上で再 throw される。

const SETTLE_MS = 400 // executorch unload / llama.rn release 後の Metal メモリ解放待ち

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runWithLlamaRn({ model, modelContext }, callback) {
  if (!model) {
    throw new Error('VLM モデルが指定されていません')
  }
  if (typeof modelContext?.setPreventLlmLoad !== 'function') {
    throw new Error('VLM orchestrator: modelContext.setPreventLlmLoad が必要です')
  }

  const downloaded = await isVlmModelDownloaded(model)
  if (!downloaded) {
    throw new Error(
      `VLM モデル「${model.label}」が未ダウンロードです。設定 > 写真 から DL してください。`,
    )
  }

  const { mainPath, mmprojPath } = getVlmModelPaths(model)

  // 1) executorch をアンロード (preventLoad=true で useLLM の cleanup が走る)
  modelContext.setPreventLlmLoad(true)
  await sleep(SETTLE_MS) // unload + Metal メモリ解放を待つ

  let llama = null
  try {
    // 2) llama.rn 初期化
    llama = await initLlama({
      model: mainPath,
      n_ctx: 4096,
      n_gpu_layers: 99, // iOS Metal フル使用 (CPU only にしたい場合は 0)
    })

    // 3) マルチモーダル拡張 (mmproj 読み込み)
    await llama.initMultimodal({ path: mmprojPath, use_gpu: true })

    // 4) ユーザー callback (実際の completion / tokenize 等)
    const result = await callback(llama)
    return result
  } finally {
    // 5) llama.rn 解放
    if (llama) {
      try {
        await llama.releaseMultimodal()
      } catch (e) {
        // 既に release 済み等は無視
      }
      try {
        await llama.release()
      } catch (e) {
        // 同上
      }
    }
    // 6) Metal メモリ解放待ち
    await sleep(SETTLE_MS)
    // 7) executorch 再ロード (preventLoad=false → useLLM が再ロード開始)
    modelContext.setPreventLlmLoad(false)
  }
}
