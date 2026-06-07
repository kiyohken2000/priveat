// llama.rn 用テキスト LLM (GGUF) のローカル DL / 削除 / 進捗管理。
//
// 設計:
//   - main GGUF 単一ファイル (VLM の main+mmproj とは別)
//   - 保存先は documentDirectory/llm-text/<modelId>/<filename>
//   - documentDirectory を使う理由: iOS が領域不足時に cacheDirectory を勝手に消す可能性を避ける
//
// expo-file-system の API 選択:
//   - legacy `createDownloadResumable` は大容量 (~800MB+) で downloadAsync の Promise が
//     resolve しないバグ実例があった (NSURLSession の最終 move 完了が JS に通知されず、
//     アプリリロードで初めてファイル出現が検出される)。
//   - 新 File API (expo-file-system 53+) はネイティブ実装が刷新されており、 同問題が無い。
//     v0.13 以降の dev 環境では legacy より新 API の方が安定。

import { Directory, File, Paths } from 'expo-file-system'

const filenameOf = (url) => url.split('/').pop()

const getDirInstance = (model) => new Directory(Paths.document, 'llm-text', model.id)
const getFileInstance = (model) => new File(getDirInstance(model), filenameOf(model.main.url))

export const getLlamaRnTextModelPaths = (model) => {
  const dirInst = getDirInstance(model)
  const fileInst = getFileInstance(model)
  return {
    dir: dirInst.uri,
    mainPath: fileInst.uri,
  }
}

export const isLlamaRnTextModelDownloaded = async (model) => {
  const file = getFileInstance(model)
  return !!file.exists
}

// アクティブな AbortController を modelId で覚えておく (cancel 用)。
const activeDownloads = new Map()

export const downloadLlamaRnTextModel = async (model, onProgress) => {
  const dir = getDirInstance(model)
  if (!dir.exists) dir.create({ intermediates: true })

  const file = getFileInstance(model)
  if (file.exists) {
    if (typeof onProgress === 'function') onProgress(1)
    return
  }

  const fallbackTotal = model.main.sizeBytes || 1
  const controller = new AbortController()
  activeDownloads.set(model.id, controller)

  try {
    await File.downloadFileAsync(model.main.url, file, {
      signal: controller.signal,
      idempotent: true,
      onProgress: ({ bytesWritten, totalBytes }) => {
        if (typeof onProgress !== 'function') return
        const expected = totalBytes > 0 ? totalBytes : fallbackTotal
        onProgress(Math.min(1, (bytesWritten ?? 0) / expected))
      },
    })
    if (typeof onProgress === 'function') onProgress(1)
  } finally {
    if (activeDownloads.get(model.id) === controller) {
      activeDownloads.delete(model.id)
    }
  }
}

export const deleteLlamaRnTextModel = async (model) => {
  const dir = getDirInstance(model)
  if (dir.exists) dir.delete()
}

export const cancelLlamaRnTextModelDownload = async (model) => {
  const controller = activeDownloads.get(model.id)
  if (!controller) return
  try {
    controller.abort()
  } catch (e) {
    // already aborted — 無視
  }
  activeDownloads.delete(model.id)
}
