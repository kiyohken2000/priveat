import AsyncStorage from '@react-native-async-storage/async-storage'

// コーチング時にシステムプロンプトへ差し込むユーザー自身の自由記述（嗜好・目標・制約など）。
// プロフィール (年齢・身長・体重・目標体重・kcal目標) ではカバーできない
// 「アドバイスのトーン」「運動習慣」「食事の好み・嫌い」などをここに集める。
const KEY = '@priveat/coach-stance'
export const STANCE_MAX_LENGTH = 1000

export const getStance = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return ''
    return raw
  } catch (e) {
    console.warn('[stance] load failed:', e)
    return ''
  }
}

export const setStance = async (value) => {
  const v = (value ?? '').slice(0, STANCE_MAX_LENGTH)
  try {
    if (v) await AsyncStorage.setItem(KEY, v)
    else await AsyncStorage.removeItem(KEY)
  } catch (e) {
    console.warn('[stance] save failed:', e)
    throw e
  }
}
