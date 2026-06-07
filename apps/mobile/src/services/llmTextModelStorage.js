// llama.rn 用テキスト LLM (GGUF) のローカル DL / 削除 / 進捗管理。
// services/vlmModelStorage.js の単一ファイル版 (mmproj が無い)。
//
// 設計上の差異:
//   - main GGUF のみで mmproj は無い → 進捗計算がシンプル (案分不要)
//   - 保存先は documentDirectory/llm-text/<modelId>/<filename>
//   - VLM 経路と同じ理由で cacheDirectory ではなく documentDirectory を使う
//     (iOS が領域不足時に勝手に消す可能性を避ける)
//
// 共有/分離の判断:
//   - VLM と同じパターンなので共通基盤に抽出することも検討したが、
//     vlmModelStorage は VLM 専用の比率計算 (main+mmproj) が組み込まれていて
//     抽象化のメリットが薄い。 ベンチマーク用途で読みやすさ優先で別ファイルにした。

// eslint-disable-next-line import/no-unresolved
import * as FileSystem from 'expo-file-system/legacy'

const TEXT_LLM_DIR = `${FileSystem.documentDirectory}llm-text/`

const filenameOf = (url) => url.split('/').pop()

export const getLlamaRnTextModelPaths = (model) => {
  const dir = `${TEXT_LLM_DIR}${model.id}/`
  return {
    dir,
    mainPath: `${dir}${filenameOf(model.main.url)}`,
  }
}

const ensureDir = async (dir) => {
  const info = await FileSystem.getInfoAsync(dir)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
  }
}

export const isLlamaRnTextModelDownloaded = async (model) => {
  const { mainPath } = getLlamaRnTextModelPaths(model)
  const info = await FileSystem.getInfoAsync(mainPath)
  return !!info.exists
}

// アクティブな downloadResumable を modelId で覚えておく (cancel 用)。
const activeDownloads = new Map()

export const downloadLlamaRnTextModel = async (model, onProgress) => {
  const { dir, mainPath } = getLlamaRnTextModelPaths(model)
  await ensureDir(dir)

  const info = await FileSystem.getInfoAsync(mainPath)
  if (info.exists) {
    if (typeof onProgress === 'function') onProgress(1)
    return
  }

  const total = model.main.sizeBytes || 1
  const dl = FileSystem.createDownloadResumable(
    model.main.url,
    mainPath,
    {},
    (state) => {
      if (typeof onProgress !== 'function') return
      const done = state?.totalBytesWritten ?? 0
      onProgress(Math.min(1, done / total))
    },
  )
  activeDownloads.set(model.id, dl)
  try {
    await dl.downloadAsync()
    if (typeof onProgress === 'function') onProgress(1)
  } finally {
    if (activeDownloads.get(model.id) === dl) {
      activeDownloads.delete(model.id)
    }
  }
}

export const deleteLlamaRnTextModel = async (model) => {
  const { dir } = getLlamaRnTextModelPaths(model)
  const info = await FileSystem.getInfoAsync(dir)
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true })
  }
}

export const cancelLlamaRnTextModelDownload = async (model) => {
  const dl = activeDownloads.get(model.id)
  if (!dl) return
  try {
    await dl.pauseAsync()
  } catch (e) {
    // already paused / done — 無視
  }
  activeDownloads.delete(model.id)
}
