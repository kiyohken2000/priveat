import { RAM_TIER, canRunOnDevice, getDeviceRamBytes } from './deviceRam'

// 端末スペック × 役割 (parser/coach) から「推奨モデル」を導出するユーティリティ。
//
// 設計方針:
//   - parser (記録用) は速度優先のため、端末スペックに関わらず常に最軽量級を推奨。
//     高品質モデルでも parser 出力 (JSON 構造化) はほぼ同じなので、メモリと時間を節約。
//   - coach (コーチ用) は応答品質に効くため、端末が許す範囲で大きめを推奨。
//
// モデルサイズ階層は `model.minDeviceRamBytes` を見て判別する:
//   TIER_4GB → 軽量級, TIER_6GB → バランス級, TIER_8GB → 高品質級

const toGb = (bytes) => (bytes == null ? null : bytes / 1024 ** 3)

// 端末ティア判定。getDeviceRamBytes が null を返す場合 (Web / 一部 simulator) は 'unknown'。
export const getDeviceTier = (ramBytes = getDeviceRamBytes()) => {
  if (ramBytes == null) {
    return { id: 'unknown', label: '不明', ramGb: null }
  }
  const ramGb = toGb(ramBytes)
  if (ramBytes >= RAM_TIER.TIER_8GB) {
    return { id: 'high', label: 'ハイエンド (約 8GB+)', ramGb }
  }
  if (ramBytes >= RAM_TIER.TIER_6GB) {
    return { id: 'mid', label: '高スペック (約 6GB)', ramGb }
  }
  if (ramBytes >= RAM_TIER.TIER_4GB) {
    return { id: 'low', label: '標準 (約 4GB)', ramGb }
  }
  return { id: 'verylow', label: '低スペック (4GB 未満)', ramGb }
}

// 役割×ティアごとの「推奨対象モデルサイズ階層」。
// 値は model.minDeviceRamBytes と比較するための閾値集合。
const RECOMMENDATION_TARGETS = {
  parser: {
    // parser は常に最軽量を推奨 (端末スペック関係なし)
    high: [RAM_TIER.TIER_4GB],
    mid: [RAM_TIER.TIER_4GB],
    low: [RAM_TIER.TIER_4GB],
    verylow: [RAM_TIER.TIER_4GB],
    unknown: [RAM_TIER.TIER_4GB],
  },
  coach: {
    // coach はスペックが許す範囲で大きめを推奨
    high: [RAM_TIER.TIER_8GB, RAM_TIER.TIER_6GB],
    mid: [RAM_TIER.TIER_6GB],
    low: [RAM_TIER.TIER_4GB],
    verylow: [RAM_TIER.TIER_4GB],
    unknown: [RAM_TIER.TIER_4GB],
  },
}

// 'recommended' | 'usable' | 'unsupported' の 3 値を返す。
//   - unsupported: そもそも RAM 不足 (canRunOnDevice が NG)
//   - recommended: 動く + 役割×ティアの推奨集合に含まれる
//   - usable:      動くが推奨ではない (小さすぎる / 大きすぎる)
export const getRecommendation = (model, role, ramBytes = getDeviceRamBytes()) => {
  const compat = canRunOnDevice(model, ramBytes)
  if (!compat.ok) return 'unsupported'
  const tier = getDeviceTier(ramBytes)
  const targets = RECOMMENDATION_TARGETS[role]?.[tier.id] ?? []
  if (targets.includes(model.minDeviceRamBytes)) return 'recommended'
  return 'usable'
}

// 各役割向けの一言ガイダンス。バナーや tabDesc 補助として使う。
export const getRoleGuidanceForTier = (tier, role) => {
  if (role === 'parser') {
    return '記録用は軽量モデルが速くておすすめ。'
  }
  switch (tier.id) {
    case 'high':
      return 'コーチ用は高品質モデル (4B 級) も快適に動きそう。'
    case 'mid':
      return 'コーチ用はバランス型 (1.7B〜2B 級) がおすすめ。'
    case 'low':
      return 'コーチ用も軽量モデル推奨。重いモデルはクラッシュ注意。'
    case 'verylow':
      return 'RAM が少なめです。軽量モデルのみ使用してください。'
    default:
      return '端末 RAM が取得できないため、軽量モデルから試すことをおすすめします。'
  }
}
