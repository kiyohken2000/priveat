import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { BarChart, LineChart } from 'react-native-gifted-charts'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import AdviceCard from '../../components/AdviceCard'
import { colors, fontSize } from '../../theme'
import { getCalorieSeries, getDailyHistory, getWeightSeries } from '../../db/history'
import { getLatestWeight, getProfile } from '../../db/profile'
import { computeBmr } from '../../utils/bmr'

const screenWidth = Dimensions.get('window').width

const monthDayLabel = (iso) => {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`
}

const weekdayChar = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(`${iso}T00:00:00`)
    return '日月火水木金土'[d.getDay()]
  } catch (e) {
    return ''
  }
}

const round = (n) => (n == null ? null : Math.round(n))

const dayKey = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// 「直近7日」アドバイス用の週始め (今日含む7日 → 6日前)。
const todayWeekStart = () => {
  const d = new Date()
  d.setDate(d.getDate() - 6)
  return dayKey(d)
}

export default function History() {
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [weightSeries, setWeightSeries] = useState([])
  const [calorieSeries, setCalorieSeries] = useState([])
  const [daily, setDaily] = useState([])
  const [bmr, setBmr] = useState(null)

  // 「直近7日」週次アドバイスの起点 (今日含む 7 日間)。マウント時に固定。
  const weekStart = useMemo(() => todayWeekStart(), [])

  const load = useCallback(async () => {
    try {
      const [w, c, list, p, latestW] = await Promise.all([
        getWeightSeries({ daysBack: 30 }),
        getCalorieSeries({ daysBack: 7 }),
        getDailyHistory({ daysBack: 30 }),
        getProfile(),
        getLatestWeight(),
      ])
      setWeightSeries(w)
      setCalorieSeries(c)
      setDaily(list)
      setBmr(
        computeBmr({
          weightKg: latestW?.weight_kg,
          heightCm: p?.height_cm,
          age: p?.age,
          sex: p?.sex,
        }),
      )
    } catch (err) {
      console.warn('[history] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  // ── 体重チャートデータ準備 ──
  const weightChart = useMemo(() => {
    if (weightSeries.length === 0) return null
    const data = weightSeries.map((r, i) => ({
      value: r.weight_kg,
      // 月をまたぐ場合や始点・終点だけラベル表示。
      label:
        i === 0 || i === weightSeries.length - 1 || i % Math.ceil(weightSeries.length / 6) === 0
          ? monthDayLabel(r.date)
          : '',
      dataPointText: '',
    }))
    const values = weightSeries.map((r) => r.weight_kg)
    return {
      data,
      max: Math.max(...values),
      min: Math.min(...values),
    }
  }, [weightSeries])

  // ── カロリーチャートデータ準備（過去7日、摂取バー＋消費バーが交互に並ぶ）──
  const calorieChart = useMemo(() => {
    if (calorieSeries.length === 0) return null
    const data = []
    for (const row of calorieSeries) {
      const burned = (row.active ?? 0) + (bmr ?? 0)
      data.push({
        value: Math.round(row.intake ?? 0),
        label: monthDayLabel(row.date),
        labelTextStyle: { color: colors.gray, fontSize: 10 },
        frontColor: colors.lightPurple,
        spacing: 2,
      })
      data.push({
        value: Math.round(burned),
        frontColor: '#3a8a3a',
      })
    }
    const maxVal = Math.max(...data.map((d) => d.value))
    return { data, maxVal }
  }, [calorieSeries, bmr])

  return (
    <ScreenTemplate>
      <ScrollView
        contentContainerStyle={styles.root}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!loaded ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.lightPurple} />
          </View>
        ) : (
          <>
            <View style={styles.titleRow}>
              <Text style={styles.title}>履歴</Text>
              <Pressable
                onPress={() => navigation.navigate('CalendarScreen')}
                style={({ pressed }) => [styles.calendarBtn, pressed && styles.btnPressed]}
              >
                <FontIcon name="calendar" size={14} color={colors.white} />
                <Text style={styles.calendarBtnText}>カレンダー</Text>
              </Pressable>
            </View>

            {/* 体重推移 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>体重推移（30日）</Text>
              {weightChart ? (
                <>
                  <LineChart
                    data={weightChart.data}
                    height={180}
                    spacing={Math.max(20, (screenWidth - 100) / Math.max(weightChart.data.length, 1))}
                    initialSpacing={10}
                    color={colors.lightPurple}
                    thickness={2}
                    dataPointsColor={colors.darkPurple}
                    dataPointsRadius={3}
                    yAxisColor="#ccc"
                    xAxisColor="#ccc"
                    yAxisTextStyle={{ color: colors.gray, fontSize: 10 }}
                    xAxisLabelTextStyle={{ color: colors.gray, fontSize: 10 }}
                    rulesColor="#f0eef7"
                    rulesType="solid"
                    noOfSections={4}
                    maxValue={Math.ceil(weightChart.max + 2)}
                    yAxisOffset={Math.floor(weightChart.min - 2)}
                  />
                  <Text style={styles.chartMeta}>
                    最高 {weightChart.max} kg ・ 最低 {weightChart.min} kg
                  </Text>
                </>
              ) : (
                <Text style={styles.placeholder}>記録がありません</Text>
              )}
            </View>

            {/* カロリー収支 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>カロリー収支（7日）</Text>
              {calorieChart ? (
                <>
                  <BarChart
                    data={calorieChart.data}
                    height={180}
                    barWidth={14}
                    spacing={14}
                    initialSpacing={10}
                    frontColor={colors.lightPurple}
                    yAxisColor="#ccc"
                    xAxisColor="#ccc"
                    yAxisTextStyle={{ color: colors.gray, fontSize: 10 }}
                    rulesColor="#f0eef7"
                    rulesType="solid"
                    noOfSections={4}
                    maxValue={Math.ceil((calorieChart.maxVal + 200) / 500) * 500}
                  />
                  <View style={styles.legend}>
                    <View style={[styles.legendDot, { backgroundColor: colors.lightPurple }]} />
                    <Text style={styles.legendText}>摂取</Text>
                    <View
                      style={[styles.legendDot, { backgroundColor: '#3a8a3a', marginLeft: 16 }]}
                    />
                    <Text style={styles.legendText}>
                      消費{bmr != null ? ' (運動+基礎代謝)' : ' (運動のみ)'}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.placeholder}>記録がありません</Text>
              )}
            </View>

            {/* 直近7日サマリーへの AI アドバイス */}
            <AdviceCard date={weekStart} period="week" />

            {/* 日別リスト */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>日別記録（30日）</Text>
              <View style={styles.listHeader}>
                <Text style={[styles.listHeaderCell, styles.colDate]}>日付</Text>
                <Text style={[styles.listHeaderCell, styles.colNum]}>摂取</Text>
                <Text style={[styles.listHeaderCell, styles.colNum]}>消費</Text>
                <Text style={[styles.listHeaderCell, styles.colNum]}>差分</Text>
                <Text style={[styles.listHeaderCell, styles.colWeight]}>体重</Text>
              </View>
              {daily.map((row) => {
                const burned = (row.active ?? 0) + (bmr ?? 0) || null
                const net = burned != null ? (row.intake ?? 0) - burned : null
                const isEmpty = !row.intake && !row.active && !row.weight
                return (
                  <Pressable
                    key={row.date}
                    onPress={() =>
                      navigation.navigate('DayDetailScreen', { date: row.date })
                    }
                    style={({ pressed }) => [
                      styles.listRow,
                      isEmpty && styles.listRowEmpty,
                      pressed && styles.btnPressed,
                    ]}
                  >
                    <View style={styles.colDate}>
                      <Text style={styles.dateMain}>{monthDayLabel(row.date)}</Text>
                      <Text style={styles.dateWeekday}>{weekdayChar(row.date)}</Text>
                    </View>
                    <Text style={[styles.cell, styles.colNum]}>
                      {row.intake > 0 ? round(row.intake) : '—'}
                    </Text>
                    <Text style={[styles.cell, styles.colNum]}>
                      {burned != null ? round(burned) : '—'}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.colNum,
                        net != null && net < 0 && styles.netDeficit,
                        net != null && net > 0 && styles.netSurplus,
                      ]}
                    >
                      {net != null ? (net > 0 ? '+' : '') + round(net) : '—'}
                    </Text>
                    <Text style={[styles.cell, styles.colWeight]}>
                      {row.weight != null ? `${row.weight}kg` : '—'}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </>
        )}
      </ScrollView>
    </ScreenTemplate>
  )
}

const styles = StyleSheet.create({
  root: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  title: {
    fontSize: fontSize.xxxLarge,
    fontWeight: '700',
    color: colors.darkPurple,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightPurple,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  calendarBtnText: {
    color: colors.white,
    fontSize: fontSize.small,
    fontWeight: '600',
    marginLeft: 6,
  },
  btnPressed: { opacity: 0.7 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    marginBottom: 12,
  },
  chartMeta: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 10,
    textAlign: 'center',
  },
  placeholder: { fontSize: fontSize.middle, color: colors.gray, textAlign: 'center', paddingVertical: 20 },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    justifyContent: 'center',
  },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: fontSize.small, color: colors.gray },
  listHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0eef7',
    marginBottom: 4,
  },
  listHeaderCell: {
    fontSize: fontSize.small,
    color: colors.gray,
    fontWeight: '600',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f4fa',
  },
  listRowEmpty: { opacity: 0.4 },
  colDate: { width: 52 },
  colNum: { flex: 1, textAlign: 'right' },
  colWeight: { width: 56, textAlign: 'right' },
  dateMain: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  dateWeekday: { fontSize: fontSize.small, color: colors.gray },
  cell: { fontSize: fontSize.middle, color: colors.darkPurple },
  netDeficit: { color: '#3a8a3a' },
  netSurplus: { color: '#c44' },
})
