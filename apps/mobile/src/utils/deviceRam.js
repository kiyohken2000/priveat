import * as Device from 'expo-device'

// 端末スペックに基づいて「このモデルを動かせるか」を判定するユーティリティ。
//   - Device.totalMemory はバイト単位。iOS / Android 実機で値が返る。
//     Web や一部の simulator では null になる場合があるので呼び出し側で吸収する。
//   - RAM_TIER の閾値は「実際に搭載されている RAM 量」より少し下に取ってある。
//     OS / ベース処理 / ガベージなどで実利用可能な RAM は搭載量より小さくなるため、
//     公称 6GB の端末では 5.3GB ぐらいが返ってくることが多い。
//   - canRunOnDevice は { ok, reason? } を返す。reason は UI にそのまま表示してよい
//     短い日本語メッセージ。

export const RAM_TIER = {
  TIER_4GB: 3.5 * 1024 ** 3, // iPhone 13 mini など
  TIER_6GB: 5.3 * 1024 ** 3, // iPhone 14 Pro など
  TIER_8GB: 7.0 * 1024 ** 3, // iPhone 15 Pro など
}

export const getDeviceRamBytes = () => {
  const total = Device?.totalMemory
  return typeof total === 'number' && total > 0 ? total : null
}

const toGb = (bytes) => (bytes / 1024 ** 3).toFixed(1)

export const canRunOnDevice = (model, ramBytes = getDeviceRamBytes()) => {
  if (model?.minDeviceRamBytes == null) return { ok: true }
  if (ramBytes == null) {
    return { ok: false, reason: '端末メモリを取得できませんでした' }
  }
  if (ramBytes < model.minDeviceRamBytes) {
    return {
      ok: false,
      reason: `このモデルには約 ${toGb(model.minDeviceRamBytes)}GB 以上の RAM が必要です（この端末: 約 ${toGb(ramBytes)}GB）`,
    }
  }
  return { ok: true }
}
