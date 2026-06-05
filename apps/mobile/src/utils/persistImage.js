import * as FileSystem from 'expo-file-system/legacy'

// OCR で読み込んだ画像を永続領域へコピーする。
//   - キャッシュ領域 (expo-image-picker のデフォルト保存先) はクリアされる可能性があるため。
//   - documentDirectory + 'ocr/{kind}_{timestamp}.{ext}' に保存し、その URI を返す。
//   - 失敗時は null を返す（呼び出し側で image_uri = null として保存）。
//
// kind は 'weight' | 'energy' | 'label' のようなテーブル/用途別タグ。
export const persistOcrImage = async (srcUri, kind = 'ocr') => {
  if (!srcUri) return null
  try {
    const dir = `${FileSystem.documentDirectory}ocr/`
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
    const extMatch = String(srcUri).match(/\.([a-zA-Z0-9]+)(\?|$)/)
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
    const filename = `${kind}_${Date.now()}.${ext}`
    const dest = `${dir}${filename}`
    await FileSystem.copyAsync({ from: srcUri, to: dest })
    return dest
  } catch (e) {
    console.warn('[persistOcrImage] failed:', e?.message ?? e)
    return null
  }
}

// 永続化した画像を削除（削除機能から呼ぶ）。失敗しても致命ではない。
export const deletePersistedImage = async (uri) => {
  if (!uri) return
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true })
  } catch (e) {
    console.warn('[deletePersistedImage] failed:', e?.message ?? e)
  }
}
