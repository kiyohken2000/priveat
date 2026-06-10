import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import { colors, fontSize } from '../../theme'
import {
  deleteFoodLogItem,
  getDayMacros,
  getDaySummary,
  getFoodLogByDate,
} from '../../db/foodLogActions'
import { deleteEnergyLogItem, getEnergyLogByDate } from '../../db/energyLog'
import { deleteWeightLogItem, getWeightLogByDate } from '../../db/weightLog'
import { getProfile, getLatestWeight } from '../../db/profile'
import { getCoachChatByDate } from '../../db/chatMessages'
import { computeBmr } from '../../utils/bmr'
import SourceBadge from '../../components/SourceBadge'
import ImagePreviewModal from '../../components/ImagePreviewModal'
import AdviceCard from '../../components/AdviceCard'
import PFCBar from '../../components/PFCBar'
import SyncHealthButton from '../../components/SyncHealthButton'

const formatDateLong = (dateStr) => {
  // dateStr: 'YYYY-MM-DD'
  const d = new Date(`${dateStr}T00:00:00`)
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

const round = (n) => (n == null ? null : Math.round(n))

const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// AdviceCard と同じ Markdown スタイル (assistant 発言の描画用)。
const CHAT_MARKDOWN_STYLE = {
  paragraph: { color: colors.black, fontSize: fontSize.middle, marginTop: 0, marginBottom: 4 },
  h1: { color: colors.darkPurple, fontSize: 18, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  h2: { color: colors.darkPurple, fontSize: 17, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  h3: { color: colors.darkPurple, fontSize: 16, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  list: { color: colors.black, fontSize: fontSize.middle, marginBottom: 4, bulletColor: colors.lightPurple },
  strong: { color: colors.darkPurple },
  blockquote: { color: colors.darkPurple, borderColor: colors.lightPurple, borderWidth: 3, backgroundColor: 'transparent' },
  code: { color: colors.darkPurple, backgroundColor: '#efedf7', fontFamily: 'Courier' },
}

export default function DayDetailScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const { date } = route.params
  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState({
    intake: 0,
    activeKcal: null,
    steps: null,
    weightKg: null,
    energySource: null,
    energyImageUri: null,
    weightSource: null,
    weightImageUri: null,
  })
  const [meals, setMeals] = useState([])
  const [energyLogs, setEnergyLogs] = useState([])
  const [weightLogs, setWeightLogs] = useState([])
  const [bmr, setBmr] = useState(null)
  const [macros, setMacros] = useState(null)
  const [coachChat, setCoachChat] = useState([])
  const [preview, setPreview] = useState({ visible: false, uri: null, title: '' })

  const showPreview = (uri, title) => setPreview({ visible: true, uri, title })
  const closePreview = () => setPreview((p) => ({ ...p, visible: false }))

  const load = useCallback(async () => {
    try {
      const [s, m, p, w, mac, chat, eRows, wRows] = await Promise.all([
        getDaySummary(date),
        getFoodLogByDate(date),
        getProfile(),
        getLatestWeight(),
        getDayMacros(date),
        getCoachChatByDate(date),
        getEnergyLogByDate(date),
        getWeightLogByDate(date),
      ])
      setSummary(s)
      setMeals(m)
      setMacros(mac)
      setCoachChat(chat)
      setEnergyLogs(eRows)
      setWeightLogs(wRows)
      setBmr(
        computeBmr({
          weightKg: w?.weight_kg,
          heightCm: p?.height_cm,
          age: p?.age,
          sex: p?.sex,
        }),
      )
    } catch (err) {
      console.warn('[dayDetail] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [date])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const onEdit = (item) => {
    navigation.navigate('EditFoodScreen', { id: item.id })
  }

  const onDelete = (item) => {
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

  // 編集可ソース: text / manual のみ。
  //   ocr / health は値の出どころが外部 (画像・同期) なので、ここからの直接編集は混乱の元。
  //   ocr は削除のみ可、health は読み取り専用 (再同期で上書きされるため)。
  const isEnergyEditable = (src) => src === 'text' || src === 'manual'
  const isEnergyDeletable = (src) => src !== 'health'
  const isWeightEditable = (src) => src === 'text' || src === 'manual'
  const isWeightDeletable = (src) => src !== 'health'

  const onEditEnergy = (row) => {
    if (!isEnergyEditable(row.source)) return
    navigation.navigate('EditEnergyScreen', { id: row.id })
  }

  const onDeleteEnergy = (row) => {
    if (!isEnergyDeletable(row.source)) return
    const desc = row.activity_name
      ? `${row.activity_name}${row.duration_min != null ? ` (${row.duration_min}分)` : ''}`
      : `${formatTimeHm(row.logged_at)} の運動`
    Alert.alert(
      '削除しますか？',
      `「${desc}」を削除します。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEnergyLogItem(row.id)
              await load()
            } catch (err) {
              Alert.alert('削除エラー', err?.message ?? String(err))
            }
          },
        },
      ],
    )
  }

  const onEditWeight = (row) => {
    if (!isWeightEditable(row.source)) return
    navigation.navigate('EditWeightScreen', { id: row.id })
  }

  const onDeleteWeight = (row) => {
    if (!isWeightDeletable(row.source)) return
    Alert.alert(
      '削除しますか？',
      `${formatTimeHm(row.measured_at)} の ${row.weight_kg}kg を削除します。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWeightLogItem(row.id)
              await load()
            } catch (err) {
              Alert.alert('削除エラー', err?.message ?? String(err))
            }
          },
        },
      ],
    )
  }

  const burned = summary.activeKcal != null || bmr != null
    ? (summary.activeKcal ?? 0) + (bmr ?? 0)
    : null
  const net = burned != null ? summary.intake - burned : null

  return (
    <>
    <ScrollView style={styles.flex} contentContainerStyle={styles.root}>
      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.lightPurple} />
        </View>
      ) : (
        <>
          {/* ヘッダーに日付が表示されるので本文では繰り返さない */}

          {/* サマリーカード */}
          <View style={styles.card}>
            <SummaryRow label="摂取" value={round(summary.intake)} unit="kcal" />
            <SummaryRow label="消費" value={round(burned)} unit="kcal" />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownText}>
                運動 {summary.activeKcal != null ? `${round(summary.activeKcal)} kcal` : '—'}
                {summary.steps != null ? ` (${summary.steps.toLocaleString()} 歩)` : ''}
              </Text>
              {summary.activeKcal != null && summary.energySource ? (
                <SourceBadge
                  source={summary.energySource}
                  hasImage={!!summary.energyImageUri}
                  onPressImage={() => showPreview(summary.energyImageUri, '運動データの読取画像')}
                />
              ) : null}
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownText}>
                基礎代謝 {bmr != null ? `${round(bmr)} kcal` : '— (未設定)'}
              </Text>
            </View>
            <View style={styles.divider} />
            <SummaryRow
              label="差分"
              value={round(net)}
              unit="kcal"
              bold
              color={net != null && net < 0 ? '#3a8a3a' : '#c44'}
            />
            {summary.weightKg != null && (
              <>
                <View style={styles.divider} />
                <SummaryRow
                  label="体重"
                  value={summary.weightKg}
                  unit="kg"
                  source={summary.weightSource}
                  imageUri={summary.weightImageUri}
                  onPressImage={() => showPreview(summary.weightImageUri, '体重の読取画像')}
                />
              </>
            )}
          </View>

          {/* ヘルスケア同期 (今日の DayDetail でのみ表示) */}
          {date === todayKey() && <SyncHealthButton onComplete={load} />}

          {/* 栄養バランス */}
          <View style={styles.card}>
            <PFCBar macros={macros} />
          </View>

          {/* AI からのアドバイス */}
          <AdviceCard date={date} kind={date === todayKey() ? 'today' : 'past'} />

          {/* この日のコーチ対話 */}
          {coachChat.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>この日のコーチ対話 ({coachChat.length / 2}件)</Text>
              {coachChat.map((msg) => (
                <View
                  key={msg.id}
                  style={[
                    styles.chatBubble,
                    msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant,
                  ]}
                >
                  {msg.role === 'user' ? (
                    <Text style={styles.chatUserText}>{msg.text}</Text>
                  ) : (
                    <>
                      <EnrichedMarkdownText
                        markdown={msg.text}
                        markdownStyle={CHAT_MARKDOWN_STYLE}
                        flavor="github"
                        allowTrailingMargin={false}
                        selectable
                      />
                      <Text style={styles.chatMeta}>
                        {formatTimeHm(msg.created_at)}
                        {msg.modelId ? ` · ${msg.modelId}` : ''}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* 運動内訳 */}
          {energyLogs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>運動内訳 ({energyLogs.length}件)</Text>
              {energyLogs.some((r) => r.source === 'health') && energyLogs.length > 1 && (
                <Text style={styles.cardNote}>
                  ※ ヘルスケア同期の合計値が運動消費として優先されます (個別入力はサマリーに加算されません)
                </Text>
              )}
              {energyLogs.map((r) => {
                const editable = isEnergyEditable(r.source)
                const deletable = isEnergyDeletable(r.source)
                const hasImage = !!r.image_uri
                // Health 行は「1日の累計」であり、logged_at は内部マーカー (正午) なので時刻表示しない
                const isDailyTotal = r.source === 'health'
                return (
                  <View key={r.id} style={styles.subRow}>
                    <Pressable
                      style={styles.subRowMain}
                      onPress={() => onEditEnergy(r)}
                      disabled={!editable}
                    >
                      <Text style={[styles.subRowTime, isDailyTotal && styles.subRowTimeWide]}>
                        {isDailyTotal ? '本日の合計' : formatTimeHm(r.logged_at)}
                      </Text>
                      <View style={styles.subRowBody}>
                        <Text style={styles.subRowName} numberOfLines={1}>
                          {r.activity_name ?? (r.steps != null ? `${r.steps.toLocaleString()}歩` : '運動')}
                          {r.duration_min != null ? ` (${r.duration_min}分)` : ''}
                        </Text>
                        <View style={styles.subRowMetaRow}>
                          <SourceBadge
                            source={r.source ?? 'manual'}
                            hasImage={hasImage}
                            onPressImage={() => showPreview(r.image_uri, '運動データの読取画像')}
                            compact={!hasImage}
                          />
                          {!editable && (
                            <Text style={styles.subRowLocked}>
                              {r.source === 'health' ? '同期データのため編集不可' : '編集不可'}
                            </Text>
                          )}
                        </View>
                      </View>
                      <Text style={styles.subRowKcal}>
                        {r.active_kcal != null ? `${round(r.active_kcal)} kcal` : '— kcal'}
                      </Text>
                    </Pressable>
                    {deletable ? (
                      <Pressable
                        style={({ pressed }) => [styles.deleteBtn, pressed && styles.btnPressed]}
                        onPress={() => onDeleteEnergy(r)}
                        hitSlop={8}
                      >
                        <FontIcon name="trash-o" size={18} color="#c44" />
                      </Pressable>
                    ) : (
                      <View style={styles.deleteBtn} />
                    )}
                  </View>
                )
              })}
            </View>
          )}

          {/* 体重内訳 */}
          {weightLogs.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>体重内訳 ({weightLogs.length}件)</Text>
              {weightLogs.map((r) => {
                const editable = isWeightEditable(r.source)
                const deletable = isWeightDeletable(r.source)
                const hasImage = !!r.image_uri
                return (
                  <View key={r.id} style={styles.subRow}>
                    <Pressable
                      style={styles.subRowMain}
                      onPress={() => onEditWeight(r)}
                      disabled={!editable}
                    >
                      <Text style={styles.subRowTime}>{formatTimeHm(r.measured_at)}</Text>
                      <View style={styles.subRowBody}>
                        <Text style={styles.subRowName}>{r.weight_kg} kg</Text>
                        <View style={styles.subRowMetaRow}>
                          <SourceBadge
                            source={r.source ?? 'manual'}
                            hasImage={hasImage}
                            onPressImage={() => showPreview(r.image_uri, '体重の読取画像')}
                            compact={!hasImage}
                          />
                          {!editable && (
                            <Text style={styles.subRowLocked}>
                              {r.source === 'health' ? '同期データのため編集不可' : '編集不可'}
                            </Text>
                          )}
                        </View>
                      </View>
                    </Pressable>
                    {deletable ? (
                      <Pressable
                        style={({ pressed }) => [styles.deleteBtn, pressed && styles.btnPressed]}
                        onPress={() => onDeleteWeight(r)}
                        hitSlop={8}
                      >
                        <FontIcon name="trash-o" size={18} color="#c44" />
                      </Pressable>
                    ) : (
                      <View style={styles.deleteBtn} />
                    )}
                  </View>
                )
              })}
            </View>
          )}

          {/* 食事リスト */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>食事 ({meals.length}件)</Text>
            {meals.length === 0 ? (
              <Text style={styles.placeholder}>この日の記録はありません</Text>
            ) : (
              meals.map((m) => (
                <View key={m.id} style={styles.mealRow}>
                  <Pressable style={styles.mealMain} onPress={() => onEdit(m)}>
                    <Text style={styles.mealTime}>{formatTimeHm(m.eaten_at)}</Text>
                    <View style={styles.mealBody}>
                      <Text style={styles.mealName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <View style={styles.mealMetaRow}>
                        <Text style={styles.mealMeta}>
                          {m.quantity != null && m.unit ? `${m.quantity}${m.unit}` : ''}
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
                    onPress={() => onDelete(m)}
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
    </>
  )
}

const SummaryRow = ({
  label,
  value,
  unit,
  sub,
  placeholder,
  bold,
  color,
  source,
  imageUri,
  onPressImage,
}) => (
  <View style={styles.summaryRow}>
    <View style={{ flex: 1 }}>
      <View style={styles.summaryLabelRow}>
        <Text style={[styles.summaryLabel, bold && styles.summaryLabelBold]}>{label}</Text>
        {value != null && source && (
          <SourceBadge
            source={source}
            hasImage={!!imageUri}
            onPressImage={onPressImage}
          />
        )}
      </View>
      {sub && <Text style={styles.summarySub}>{sub}</Text>}
    </View>
    {value != null ? (
      <Text style={[styles.summaryValue, bold && styles.summaryValueBold, color && { color }]}>
        {value > 0 && bold ? '+' : ''}
        {value} {unit}
      </Text>
    ) : (
      <Text style={styles.placeholder}>{placeholder ?? '—'}</Text>
    )}
  </View>
)

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: { padding: 16, paddingBottom: 40 },
  center: { alignItems: 'center', paddingTop: 60 },
  dateTitle: {
    fontSize: fontSize.xLarge,
    fontWeight: '700',
    color: colors.darkPurple,
    marginBottom: 16,
    textAlign: 'center',
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
    borderWidth: 1,
    borderColor: '#f0eef7',
  },
  cardTitle: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  summaryLabel: { fontSize: fontSize.middle, color: colors.darkPurple },
  summaryLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryLabelBold: { fontWeight: '700' },
  summarySub: { fontSize: fontSize.small, color: colors.gray, marginTop: 2 },
  summaryValue: { fontSize: fontSize.large, color: colors.darkPurple, fontWeight: '600' },
  summaryValueBold: { fontSize: fontSize.xLarge, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#e5e2f0', marginVertical: 8 },
  placeholder: { fontSize: fontSize.middle, color: colors.gray },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingLeft: 8,
    marginTop: -2,
    marginBottom: 2,
    gap: 4,
  },
  breakdownText: { fontSize: fontSize.small, color: colors.gray },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0eef7',
  },
  mealMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  mealTime: { fontSize: fontSize.small, color: colors.gray, width: 50 },
  mealBody: { flex: 1, paddingHorizontal: 8 },
  mealName: { fontSize: fontSize.middle, color: colors.darkPurple },
  mealMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  mealMeta: { fontSize: fontSize.small, color: colors.gray },
  mealKcal: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  deleteBtn: { padding: 10, marginLeft: 4, minWidth: 38 },
  btnPressed: { opacity: 0.6 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0eef7',
  },
  subRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  subRowTime: { fontSize: fontSize.small, color: colors.gray, width: 50 },
  subRowTimeWide: { width: 64 },
  subRowBody: { flex: 1, paddingHorizontal: 8 },
  subRowName: { fontSize: fontSize.middle, color: colors.darkPurple },
  subRowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  subRowLocked: { fontSize: fontSize.small - 1, color: colors.gray },
  subRowKcal: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  cardNote: {
    fontSize: fontSize.small,
    color: colors.gray,
    backgroundColor: '#fafafe',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
    lineHeight: 16,
  },
  chatBubble: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    maxWidth: '88%',
  },
  chatBubbleUser: {
    backgroundColor: colors.lightPurple,
    alignSelf: 'flex-end',
  },
  chatBubbleAssistant: {
    backgroundColor: '#fafafe',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#f0eef7',
  },
  chatMeta: {
    fontSize: 10,
    color: colors.gray,
    marginTop: 6,
    textAlign: 'right',
  },
  chatUserText: {
    color: colors.white,
    fontSize: fontSize.middle,
  },
})
