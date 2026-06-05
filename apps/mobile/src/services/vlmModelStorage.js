// SDK 56 で expo-file-system の新 API (File / Directory / Paths クラスベース) が
// デフォルト export になり、documentDirectory や createDownloadResumable などの
// 旧 API は /legacy 配下に移動した。VLM の GGUF DL は単純なファイル DL なので、
// legacy API で十分かつ最小変更で済む。
// eslint-disable-next-line import/no-unresolved
import * as FileSystem from 'expo-file-system/legacy'
import { totalVlmModelSizeBytes } from '../data/llmModelsVlm'

// VLM (GGUF) モデルファイルの DL / 削除 / 進捗管理。
// 既存の services/modelStorage.js は executorch (ExpoResourceFetcher) 専用なので、
// llama.rn 用に別ユーティリティを置く。
//
// 設計:
//   - 保存先は FileSystem.documentDirectory + 'vlm/<modelId>/<filename>'
//     (cacheDirectory は iOS が領域不足で消す可能性があるため避ける。
//      数百MB〜1GB 級のモデルが勝手に消えると UX が悪い)
//   - main GGUF + mmproj GGUF の 2 ファイルを順番に DL
//   - 進捗 callback (0..1) は両ファイル合算で案分 (sizeBytes ベース)
//   - cancel は downloadResumable.pauseAsync() で中断

const VLM_DIR = `${FileSystem.documentDirectory}vlm/`

const filenameOf = (url) => url.split('/').pop()

export const getVlmModelPaths = (model) => {
  const dir = `${VLM_DIR}${model.id}/`
  return {
    dir,
    mainPath: `${dir}${filenameOf(model.main.url)}`,
    mmprojPath: `${dir}${filenameOf(model.mmproj.url)}`,
  }
}

const ensureDir = async (dir) => {
  const info = await FileSystem.getInfoAsync(dir)
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true })
  }
}

export const isVlmModelDownloaded = async (model) => {
  const { mainPath, mmprojPath } = getVlmModelPaths(model)
  const [a, b] = await Promise.all([
    FileSystem.getInfoAsync(mainPath),
    FileSystem.getInfoAsync(mmprojPath),
  ])
  return a.exists && b.exists
}

// アクティブな downloadResumable を modelId で覚えておく (cancel 用)。
const activeDownloads = new Map()

// 2 ファイル DL の合算進捗を作る。
//   filePartStartBytes: これより前のファイルがどれだけ完了しているか
//   filePartSize:       今 DL 中のファイルのサイズ (進捗判定用にも使う)
const makeProgressHandler = (onProgress, filePartStartBytes, totalSize) => (state) => {
  if (typeof onProgress !== 'function') return
  const bytesInFile = state?.totalBytesWritten ?? 0
  const totalDoneBytes = filePartStartBytes + bytesInFile
  const p = Math.min(1, totalDoneBytes / totalSize)
  onProgress(p)
}

const downloadOne = async ({ modelId, url, dest, onProgress, partStartBytes, totalSize }) => {
  const info = await FileSystem.getInfoAsync(dest)
  if (info.exists) {
    if (typeof onProgress === 'function') {
      onProgress(Math.min(1, (partStartBytes + (info.size ?? 0)) / totalSize))
    }
    return
  }
  const dl = FileSystem.createDownloadResumable(
    url,
    dest,
    {},
    makeProgressHandler(onProgress, partStartBytes, totalSize),
  )
  activeDownloads.set(modelId, dl)
  try {
    await dl.downloadAsync()
  } finally {
    if (activeDownloads.get(modelId) === dl) {
      activeDownloads.delete(modelId)
    }
  }
}

export const downloadVlmModel = async (model, onProgress) => {
  const { dir, mainPath, mmprojPath } = getVlmModelPaths(model)
  await ensureDir(dir)

  const totalSize = totalVlmModelSizeBytes(model) || 1
  const mainSize = model.main.sizeBytes ?? 0

  await downloadOne({
    modelId: model.id,
    url: model.main.url,
    dest: mainPath,
    onProgress,
    partStartBytes: 0,
    totalSize,
  })

  await downloadOne({
    modelId: model.id,
    url: model.mmproj.url,
    dest: mmprojPath,
    onProgress,
    partStartBytes: mainSize,
    totalSize,
  })

  if (typeof onProgress === 'function') onProgress(1)
}

export const deleteVlmModel = async (model) => {
  const { dir } = getVlmModelPaths(model)
  const info = await FileSystem.getInfoAsync(dir)
  if (info.exists) {
    await FileSystem.deleteAsync(dir, { idempotent: true })
  }
}

export const cancelVlmModelDownload = async (model) => {
  const dl = activeDownloads.get(model.id)
  if (!dl) return
  try {
    await dl.pauseAsync()
  } catch (e) {
    // already paused / done — 無視
  }
  activeDownloads.delete(model.id)
}

// カタログから DL 済みの modelId 一覧を返す (設定画面で○表示などに使う)。
export const listDownloadedVlmModelIds = async (catalog) => {
  const info = await FileSystem.getInfoAsync(VLM_DIR)
  if (!info.exists) return []
  const dirs = await FileSystem.readDirectoryAsync(VLM_DIR)
  const downloaded = await Promise.all(
    catalog.map(async (m) => {
      if (!dirs.includes(m.id)) return null
      const ok = await isVlmModelDownloaded(m)
      return ok ? m.id : null
    }),
  )
  return downloaded.filter(Boolean)
}
