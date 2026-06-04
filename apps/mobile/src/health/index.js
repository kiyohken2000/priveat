import { Platform } from 'react-native'

// iOS は @kingstinct/react-native-healthkit (v14, TurboModule + Nitro)、
// Android は react-native-health-connect を直接呼ぶ。
// 識別子は文字列リテラル、isHealthDataAvailable は同期、
// requestAuthorization は { toRead, toShare } オブジェクト。

const rangeFromDaysBack = (daysBack) => {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - daysBack * 24 * 3600 * 1000)
  return { startDate, endDate }
}

const HK = {
  bodyMass: 'HKQuantityTypeIdentifierBodyMass',
  activeEnergyBurned: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  stepCount: 'HKQuantityTypeIdentifierStepCount',
}

// ---- iOS ----
// HealthKit の queryStatisticsCollectionForQuantity を使い、ネイティブ側で
// 1日単位に集計してから JS へ返す。Apple Watch ユーザーは生サンプルが1日数百〜数千件
// あり、ブリッジ越しに渡すとクラッシュするため、必ず集計クエリを使う。
const fetchIOS = async ({ daysBack }) => {
  const HealthKit = require('@kingstinct/react-native-healthkit')

  const available = HealthKit.isHealthDataAvailable()
  console.log('[health][ios] isHealthDataAvailable:', available)
  if (!available) throw new Error('HealthKit が利用できません。')

  const granted = await HealthKit.requestAuthorization({
    toRead: [HK.bodyMass, HK.activeEnergyBurned, HK.stepCount],
    toShare: [],
  })
  console.log('[health][ios] requestAuthorization:', granted)

  const { startDate, endDate } = rangeFromDaysBack(daysBack)
  // anchor は日付の0時に揃える（バケット境界が深夜になるように）
  const anchorDate = new Date(startDate)
  anchorDate.setHours(0, 0, 0, 0)
  const interval = { day: 1 }
  // kingstinct の FilterForSamples では date が { date: { startDate, endDate } } にネスト。
  // トップレベルの startDate/endDate は無視される（全期間返る）ので注意。
  const filter = { date: { startDate, endDate } }

  const [weightStats, energyStats, stepsStats] = await Promise.all([
    // 体重: その日の最新値（mostRecent）
    HealthKit.queryStatisticsCollectionForQuantity(
      HK.bodyMass,
      ['mostRecent'],
      anchorDate,
      interval,
      { filter, unit: 'kg' },
    ),
    // 消費カロリー: その日の累積合計
    HealthKit.queryStatisticsCollectionForQuantity(
      HK.activeEnergyBurned,
      ['cumulativeSum'],
      anchorDate,
      interval,
      { filter, unit: 'kcal' },
    ),
    // 歩数: その日の累積合計
    HealthKit.queryStatisticsCollectionForQuantity(
      HK.stepCount,
      ['cumulativeSum'],
      anchorDate,
      interval,
      { filter, unit: 'count' },
    ),
  ])

  return {
    weights: (weightStats ?? [])
      .filter((s) => s.mostRecentQuantity != null)
      .map((s) => ({
        value: s.mostRecentQuantity.quantity,
        time: s.mostRecentQuantityDateInterval?.start ?? s.startDate,
      })),
    activeEnergy: (energyStats ?? [])
      .filter((s) => s.sumQuantity != null && s.sumQuantity.quantity > 0)
      .map((s) => ({ value: s.sumQuantity.quantity, time: s.startDate })),
    steps: (stepsStats ?? [])
      .filter((s) => s.sumQuantity != null && s.sumQuantity.quantity > 0)
      .map((s) => ({ value: s.sumQuantity.quantity, time: s.startDate })),
  }
}

// ---- Android ----
const fetchAndroid = async ({ daysBack, limit }) => {
  const {
    initialize,
    requestPermission,
    readRecords,
    getSdkStatus,
    SdkAvailabilityStatus,
  } = require('react-native-health-connect')

  const status = await getSdkStatus()
  console.log('[health][android] sdk status:', status)
  if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
    const reasons = {
      [SdkAvailabilityStatus.SDK_UNAVAILABLE]:
        'Health Connect が未インストールです。Play ストアからインストールしてください。',
      [SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED]:
        'Health Connect のアップデートが必要です。Play ストアから更新してください。',
    }
    throw new Error(reasons[status] ?? 'Health Connect が利用できません。')
  }

  await initialize()
  await requestPermission([
    { accessType: 'read', recordType: 'Weight' },
    { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
    { accessType: 'read', recordType: 'Steps' },
  ])

  const { startDate, endDate } = rangeFromDaysBack(daysBack)
  const filter = {
    timeRangeFilter: {
      operator: 'between',
      startTime: startDate.toISOString(),
      endTime: endDate.toISOString(),
    },
    ascendingOrder: false,
  }
  // health-connect は pageSize 省略で全件、指定で制限。limit<=0 は省略扱い。
  if (limit > 0) filter.pageSize = limit

  const [weightRes, energyRes, stepsRes] = await Promise.all([
    readRecords('Weight', filter),
    readRecords('ActiveCaloriesBurned', filter),
    readRecords('Steps', filter),
  ])

  return {
    weights: (weightRes?.records ?? []).map((r) => ({
      value: r.weight?.inKilograms ?? null,
      time: r.time,
    })),
    activeEnergy: (energyRes?.records ?? []).map((r) => ({
      value: r.energy?.inKilocalories ?? null,
      time: r.startTime,
    })),
    steps: (stepsRes?.records ?? []).map((r) => ({
      value: r.count ?? null,
      time: r.startTime,
    })),
  }
}

// 共通の取得関数。daysBack 日前から現在までのサンプル/集計を返す。
// iOS は queryStatisticsCollectionForQuantity でネイティブ集計（1日1値）。
// Android は raw sample query（health-connect は通常そこまで件数が多くない）。
export const fetchHealthSamples = async ({ daysBack = 7, limit = 200 } = {}) => {
  const data =
    Platform.OS === 'ios'
      ? await fetchIOS({ daysBack })
      : await fetchAndroid({ daysBack, limit })
  console.log('[health] weights:', data.weights.length, data.weights[0])
  console.log('[health] activeEnergy:', data.activeEnergy.length, data.activeEnergy[0])
  console.log('[health] steps:', data.steps.length, data.steps[0])
  return data
}
