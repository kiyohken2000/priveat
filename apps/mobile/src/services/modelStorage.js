import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'

// Qwen3 系のモデルは tokenizer / tokenizerConfig を共有している。
// 削除は modelSource (.pte) だけにして tokenizer は残す（他モデルが使う可能性があるため）。
// ダウンロード判定も modelSource だけ見れば十分（同じ tokenizer は最初に DL したモデルと
// 一緒に降りてくる）。

// executorch の expo fetcher は URL 全体をサニタイズして1ファイル名にする:
//   https://example.com/foo/bar.pte → example_com_foo_bar.pte
// 内部実装 (ResourceFetcherUtils.getFilenameFromUri) と完全に同じ変換をする必要がある。
const getFilenameFromUrl = (url) => {
  if (!url) return null
  let cleanUri = String(url).replace(/^https?:\/\//, '')
  cleanUri = cleanUri.split('#')?.[0] ?? cleanUri
  return cleanUri.replace(/[^a-zA-Z0-9._-]/g, '_')
}

const allSourcesOf = (model) => [
  model.source.modelSource,
  model.source.tokenizerSource,
  model.source.tokenizerConfigSource,
].filter(Boolean)

// ダウンロード済みのモデル ID 一覧を返す（カタログ照合用）。
export const listDownloadedModelIds = async (catalog) => {
  const files = await ExpoResourceFetcher.listDownloadedFiles()
  const localNames = new Set(files.map((f) => f.split('/').pop()))
  return catalog
    .filter((m) => {
      const expected = getFilenameFromUrl(m.source.modelSource)
      return expected ? localNames.has(expected) : false
    })
    .map((m) => m.id)
}

// 単一モデルのダウンロード。progress は 0..1 で呼ばれる。
//   tokenizer も含めて fetch。既にあるファイルはスキップされる（fetcher は idempotent）。
export const downloadModel = async (model, onProgress) => {
  const sources = allSourcesOf(model)
  await ExpoResourceFetcher.fetch(
    (p) => {
      if (typeof onProgress === 'function') onProgress(p)
    },
    ...sources,
  )
}

// 削除は modelSource (.pte) だけ。tokenizer は他の Qwen3 でも使うので残す。
export const deleteModel = async (model) => {
  await ExpoResourceFetcher.deleteResources(model.source.modelSource)
}

// 現在ダウンロード進行中のダウンロードをキャンセル。
export const cancelDownload = async (model) => {
  const sources = allSourcesOf(model)
  try {
    await ExpoResourceFetcher.cancelFetching(...sources)
  } catch (e) {
    // already canceled / not active — 無視
  }
}
