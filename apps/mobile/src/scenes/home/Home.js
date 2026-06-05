import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import SourceBadge from '../../components/SourceBadge'
import ImagePreviewModal from '../../components/ImagePreviewModal'
import AdviceCard from '../../components/AdviceCard'
import PFCBar from '../../components/PFCBar'
import { colors, fontSize } from '../../theme'
import { getLatestWeight, getProfile } from '../../db/profile'
import { getTodayEnergy, getTodayIntakeKcal, getTodayMacros, getTodayMeals } from '../../db/home'
import { deleteFoodLogItem } from '../../db/foodLogActions'
import { computeBmr } from '../../utils/bmr'

const formatDateLong = (d) => {
  const days = ['日', '月', '火', '水', '木', '金', '土']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${days[d.getDay()]})`
}

const formatTimeHm = (iso) => {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch (e) {
    return '--:--'
  }
}

const formatDateShort = (iso) => {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch (e) {
    return null
  }
}

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const round = (n) => (n == null ? null : Math.round(n))

export default function Home() {
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [intake, setIntake] = useState(0)
  const [energy, setEnergy] = useState({ activeKcal: null, steps: null, source: null, imageUri: null })
  const [bmr, setBmr] = useState(null)
  const [profileTarget, setProfileTarget] = useState(null)
  const [latestWeight, setLatestWeight] = useState(null)
  const [meals, setMeals] = useState([])
  const [macros, setMacros] = useState(null)
  const [preview, setPreview] = useState({ visible: false, uri: null, title: '' })

  const showPreview = (uri, title) => setPreview({ visible: true, uri, title })
  const closePreview = () => setPreview((p) => ({ ...p, visible: false }))

  const load = useCallback(async () => {
    try {
      const [p, w, intakeKcal, energyRow, mealRows, macroRow] = await Promise.all([
        getProfile(),
        getLatestWeight(),
        getTodayIntakeKcal(),
        getTodayEnergy(),
        getTodayMeals(),
        getTodayMacros(),
      ])
      setIntake(intakeKcal)
      setEnergy(energyRow)
      setMeals(mealRows)
      setMacros(macroRow)
      // BMR 計算には profile + 最新体重が必要
      const computed = computeBmr({
        weightKg: w?.weight_kg,
        heightCm: p?.height_cm,
        age: p?.age,
        sex: p?.sex,
      })
      setBmr(computed)
      setProfileTarget(p?.daily_kcal_target ?? null)
      setLatestWeight(w)
    } catch (err) {
      console.warn('[home] load error:', err)
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

  const onEditMeal = (item) => {
    navigation.navigate('EditFoodScreen', { id: item.id })
  }

  const onDeleteMeal = (item) => {
    Alert.alert(
      '削除しますか？',
      `「${item.name}」を削除します。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteFoodLogItem(item.id)
              await load()
            } catch (err) {
              Alert.alert('削除エラー', err?.message ?? String(err))
            }
          },
        },
      ],
    )
  }

  // 消費の合計（運動 + 基礎代謝）。どちらも null なら合計も null。
  const totalExpenditure =
    energy.activeKcal == null && bmr == null
      ? null
      : (energy.activeKcal ?? 0) + (bmr ?? 0)
  const net = totalExpenditure != null ? intake - totalExpenditure : null
  const targetRemaining = profileTarget != null ? profileTarget - intake : null
  const targetPct =
    profileTarget != null && profileTarget > 0
      ? Math.min(100, Math.max(0, Math.round((intake / profileTarget) * 100)))
      : null

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
            <Text style={styles.date}>{formatDateLong(new Date())}</Text>
            <Text style={styles.title}>今日のサマリー</Text>

            {/* 摂取・消費・差分 */}
            <View style={styles.card}>
              <KcalRow label="摂取" value={round(intake)} />
              <KcalRow
                label="消費 (運動)"
                value={round(energy.activeKcal)}
                subText={energy.steps != null ? `${energy.steps.toLocaleString()} 歩` : null}
                source={energy.source}
                imageUri={energy.imageUri}
                onPressImage={() => showPreview(energy.imageUri, '運動データの読取画像')}
              />
              <KcalRow
                label="消費 (基礎代謝)"
                value={round(bmr)}
                placeholder="プロフィール未設定"
                source={bmr != null ? 'manual' : null}
              />

              <View style={styles.divider} />

              <KcalRow
                label="差分 (摂取 − 消費)"
                value={round(net)}
                color={net != null && net < 0 ? '#3a8a3a' : '#c44'}
                bold
                placeholder="—"
              />
            </View>

            {/* 目標進捗 */}
            {profileTarget != null && (
              <View style={styles.card}>
                <View style={styles.targetHeader}>
                  <Text style={styles.cardTitle}>1日の目標</Text>
                  <Text style={styles.targetValue}>
                    {round(intake)} / {round(profileTarget)} kcal
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${targetPct}%` },
                      targetPct >= 100 && styles.progressFillOver,
                    ]}
                  />
                </View>
                <Text style={styles.targetRemaining}>
                  {targetRemaining >= 0
                    ? `残り ${round(targetRemaining)} kcal`
                    : `超過 ${round(-targetRemaining)} kcal`}
                </Text>
              </View>
            )}

            {/* 栄養バランス (PFC) */}
            <View style={styles.card}>
              <PFCBar macros={macros} />
            </View>

            {/* AI からのアドバイス */}
            <AdviceCard date={todayKey()} kind="today" />

            {/* 最新体重 */}
            <View style={styles.card}>
              <View style={styles.weightHeader}>
                <Text style={styles.cardTitle}>最新の体重</Text>
                {latestWeight?.source && (
                  <SourceBadge
                    source={latestWeight.source}
                    hasImage={!!latestWeight.image_uri}
                    onPressImage={() => showPreview(latestWeight.image_uri, '体重の読取画像')}
                  />
                )}
              </View>
              {latestWeight ? (
                <>
                  <Text style={styles.weightValue}>{latestWeight.weight_kg} kg</Text>
                  <Text style={styles.weightDate}>
                    {formatDateShort(latestWeight.measured_at)} 記録
                  </Text>
                </>
              ) : (
                <Text style={styles.placeholder}>未記録（設定 &gt; プロフィールで入力）</Text>
              )}
            </View>

            {/* 今日の食事 */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>今日の食事 ({meals.length}件)</Text>
              {meals.length === 0 ? (
                <Text style={styles.placeholder}>まだ記録がありません</Text>
              ) : (
                meals.map((m) => (
                  <View key={m.id} style={styles.mealRow}>
                    <Pressable style={styles.mealMainPressable} onPress={() => onEditMeal(m)}>
                      <Text style={styles.mealTime}>{formatTimeHm(m.eaten_at)}</Text>
                      <View style={styles.mealMain}>
                        <Text style={styles.mealName} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <View style={styles.mealMetaRow}>
                          <Text style={styles.mealMeta}>
                            {m.quantity != null && m.unit ? `${m.quantity}${m.unit}` : ''}
                            {m.portion && m.portion !== 'normal' ? ` (${m.portion})` : ''}
                          </Text>
                          <SourceBadge source={m.source ?? 'text_llm'} compact />
                        </View>
                      </View>
                      <Text style={styles.mealKcal}>
                        {m.kcal != null ? `${round(m.kcal)} kcal` : '— kcal'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={({ pressed }) => [styles.deleteBtn, pressed && styles.btnPressed]}
                      onPress={() => onDeleteMeal(m)}
                      hitSlop={8}
                    >
                      <FontIcon name="trash-o" size={18} color="#c44" />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
      <ImagePreviewModal
        visible={preview.visible}
        imageUri={preview.uri}
        title={preview.title}
        onClose={closePreview}
      />
    </ScreenTemplate>
  )
}

const KcalRow = ({
  label,
  value,
  color,
  subText,
  placeholder,
  bold,
  source,
  imageUri,
  onPressImage,
}) => (
  <View style={styles.kcalRow}>
    <View style={styles.kcalRowLeft}>
      <View style={styles.kcalLabelRow}>
        <Text style={[styles.kcalLabel, bold && styles.kcalLabelBold]}>{label}</Text>
        {value != null && source && (
          <SourceBadge source={source} hasImage={!!imageUri} onPressImage={onPressImage} />
        )}
      </View>
      {subText && <Text style={styles.kcalSub}>{subText}</Text>}
    </View>
    {value != null ? (
      <Text style={[styles.kcalValue, bold && styles.kcalValueBold, color && { color }]}>
        {value > 0 && bold ? '+' : ''}
        {value} kcal
      </Text>
    ) : (
      <Text style={styles.placeholder}>{placeholder ?? '—'}</Text>
    )}
  </View>
)

const styles = StyleSheet.create({
  root: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  date: {
    fontSize: fontSize.small,
    color: colors.gray,
    textAlign: 'center',
    marginTop: 6,
  },
  title: {
    fontSize: fontSize.xxLarge,
    fontWeight: '700',
    color: colors.darkPurple,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
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
    marginBottom: 8,
  },
  kcalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  kcalRowLeft: { flexShrink: 1, paddingRight: 8 },
  kcalLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kcalLabel: { fontSize: fontSize.middle, color: colors.darkPurple },
  kcalLabelBold: { fontWeight: '700' },
  kcalSub: { fontSize: fontSize.small, color: colors.gray, marginTop: 2 },
  kcalValue: { fontSize: fontSize.large, color: colors.darkPurple, fontWeight: '600' },
  kcalValueBold: { fontSize: fontSize.xLarge, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#e5e2f0', marginVertical: 8 },
  placeholder: { fontSize: fontSize.middle, color: colors.gray },
  targetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  targetValue: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  progressTrack: {
    height: 10,
    backgroundColor: '#e5e2f0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.lightPurple },
  progressFillOver: { backgroundColor: '#c44' },
  targetRemaining: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 6,
    textAlign: 'right',
  },
  weightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weightValue: {
    fontSize: fontSize.xxLarge,
    fontWeight: '700',
    color: colors.darkPurple,
  },
  weightDate: { fontSize: fontSize.small, color: colors.gray, marginTop: 2 },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0eef7',
  },
  mealMainPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  mealTime: { fontSize: fontSize.small, color: colors.gray, width: 50 },
  mealMain: { flex: 1, paddingHorizontal: 8 },
  mealName: { fontSize: fontSize.middle, color: colors.darkPurple },
  mealMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  mealMeta: { fontSize: fontSize.small, color: colors.gray },
  mealKcal: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  deleteBtn: { padding: 10, marginLeft: 4 },
  btnPressed: { opacity: 0.6 },
})
