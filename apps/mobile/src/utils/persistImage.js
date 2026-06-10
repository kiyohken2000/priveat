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

// DB に保存された image_uri をレンダリング用に解決する。
//
// iOS sandbox 問題対策:
//   永続化した画像 URI は file:///var/mobile/Containers/Data/Application/<UUID>/Documents/ocr/...
//   のような絶対パスで DB に焼き付いている。 <UUID> は EAS dev build を再インストール
//   すると変わるため、 古い絶対パスは解決できなくなる。 ファイル自体は iOS が新コンテナの
//   Documents/ へ移行するので、 URI の "Documents/" 以降を切り出して現在の
//   FileSystem.documentDirectory に張り付け直せば描画できる。
//
//   将来の登録は相対パス保存に切り替える余地はあるが、 ここでは既存行救済を優先する
//   薄いレイヤーに留める。
export const resolveOcrImageUri = (uri) => {
  if (!uri) return null
  const s = String(uri)
  const docDir = FileSystem.documentDirectory
  if (!docDir) return s
  if (s.startsWith(docDir)) return s
  const marker = '/Documents/'
  const idx = s.indexOf(marker)
  if (idx === -1) return s
  const tail = s.slice(idx + marker.length)
  return `${docDir}${tail}`
}
