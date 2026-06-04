import * as ImagePicker from 'expo-image-picker'
import MlkitOcr from 'rn-mlkit-ocr'

// カメラから撮影。許可が無ければエラーを投げる。キャンセル時は null を返す。
export const captureFromCamera = async () => {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (perm.status !== 'granted') {
    throw new Error('カメラの利用許可が必要です（設定アプリから有効化してください）')
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    allowsEditing: false,
  })
  if (result.canceled) return null
  return result.assets?.[0]?.uri ?? null
}

// 写真ライブラリから選択。キャンセル時は null を返す。
export const pickFromLibrary = async () => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (perm.status !== 'granted') {
    throw new Error('写真ライブラリの利用許可が必要です（設定アプリから有効化してください）')
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    quality: 0.8,
    allowsEditing: false,
    mediaTypes: ['images'],
  })
  if (result.canceled) return null
  return result.assets?.[0]?.uri ?? null
}

// 画像 URI に対して日本語 OCR を実行。生の result オブジェクトを返す。
//   result.text: 全テキストを改行で結合した文字列
//   result.blocks: [{ text, lines: [{ text, elements: [{ text }] }] }]
export const runOcr = async (uri) => {
  if (!uri) throw new Error('画像 URI が空です')
  return MlkitOcr.recognizeText(uri, 'japanese')
}
