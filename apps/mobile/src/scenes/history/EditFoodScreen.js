import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import DateTimePickerModal from 'react-native-modal-datetime-picker'
import { colors, fontSize } from '../../theme'
import { getFoodLogItem, updateFoodLogItem } from '../../db/foodLogActions'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import { portionFactor } from '../../db/foodLog'
import FoodNameInput from '../../components/FoodNameInput'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'

const toNum = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}

const formatDateTime = (iso) => {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch (e) {
    return iso
  }
}

export default function EditFoodScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const { id } = route.params

  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [portion, setPortion] = useState('normal')
  const [kcal, setKcal] = useState('')
  const [eatenAt, setEatenAt] = useState(new Date())
  const [pickerVisible, setPickerVisible] = useState(false)
  // kcal の出どころモード:
  //   - 'auto'         : DB 再計算追従 (recomputed が反映されたら kcal 上書き)
  //   - 'manual'       : ユーザー手入力 (DB 再計算を反映しない)
  //   - 'llm_estimate' : 「AI 推定」ボタンで LLM が出した値
  //   - 再計算 / AI 推定 / 手入力ボタンで切り替わる。
  const [kcalMode, setKcalMode] = useState('auto')
  // 直近の再計算結果（プレビュー用）。null = 再計算不能（マッチなし等）
  const [recomputed, setRecomputed] = useState(null)
  const recomputeSeqRef = useRef(0)
  // AI 推定の進行中フラグと最後のエラー (UI ヒント用)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState(null)
  const llm = useActiveLLM()
  const { activeModel } = useActiveModel()

  const load = useCallback(async () => {
    try {
      const row = await getFoodLogItem(id)
      if (!row) {
        Alert.alert('エラー', '対象の食事ログが見つかりません。')
        navigation.goBack()
        return
      }
      setName(row.name ?? '')
      setQuantity(row.quantity != null ? String(row.quantity) : '')
      setUnit(row.unit ?? '')
      setPortion(row.portion ?? 'normal')
      setKcal(row.kcal != null ? String(row.kcal) : '')
      setEatenAt(new Date(row.eaten_at))
    } catch (err) {
      console.warn('[editFood] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [id, navigation])

  useEffect(() => {
    load()
  }, [load])

  // name / quantity / unit / portion 変更で kcal を再計算（300ms デバウンス）。
  //   - findBestFood で foods 表を引き、computeKcalFromMatch で baseKcal を算出
  //   - portionFactor を掛けた最終 kcal を recomputed に保持
  //   - kcalMode='auto' のときのみ実際に kcal フィールドへ反映
  useEffect(() => {
    if (!loaded) return
    const qty = toNum(quantity)
    if (!name.trim() || qty == null || !unit.trim()) {
      setRecomputed(null)
      return
    }
    const seq = ++recomputeSeqRef.current
    const handle = setTimeout(async () => {
      try {
        const matched = await findBestFood(name.trim())
        const baseKcal = computeKcalFromMatch(matched, qty, unit.trim(), name.trim())
        if (seq !== recomputeSeqRef.current) return // 古い結果は破棄
        if (baseKcal == null) {
          setRecomputed(null)
          return
        }
        const final = Math.round(baseKcal * portionFactor(portion))
        setRecomputed(final)
        if (kcalMode === 'auto') setKcal(String(final))
      } catch (e) {
        console.warn('[editFood] recompute failed:', e)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [loaded, name, quantity, unit, portion, kcalMode])

  // 「AI 推定」ボタン: アクティブ LLM (= 通常は parser モデル) に常識的な kcal を1つ整数で
  // 返してもらう。 DB ヒットしない料理 (ステーキ定食 / チェーン店メニュー など) の救済用。
  const onPressAiEstimate = async () => {
    setAiError(null)
    if (aiBusy) return
    if (!name.trim() || !unit.trim()) {
      setAiError('食品名と単位を入力してください')
      return
    }
    if (!llm || !llm.isReady || llm.isGenerating) {
      setAiError('AI モデルがまだ準備中です。少し待ってからお試しください')
      return
    }
    const qty = toNum(quantity) ?? 1
    const prompt =
      `「${name.trim()} ${qty}${unit.trim()}」の常識的なカロリーを、整数1つだけで答えてください。` +
      `説明・単位・記号は不要。例: 250`
    setAiBusy(true)
    const messages = [
      { role: 'system', content: '日本語で常識的なカロリーを1つの整数で返してください。' },
      { role: 'user', content: prompt },
    ]
    console.log('========== AI kcal estimate ==========')
    console.log('[model]', activeModel?.id ?? '(unknown)')
    console.log('[messages]', JSON.stringify(messages, null, 2))
    try {
      const raw = await llm.generate(messages)
      console.log('[raw]', raw)
      const cleaned = String(raw ?? '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/[^0-9]/g, ' ')
      const match = cleaned.match(/\d+/)
      const n = match ? parseInt(match[0], 10) : NaN
      if (!Number.isFinite(n) || n <= 0 || n > 2000) {
        console.log('[result] rejected (out of range or non-numeric)')
        console.log('======================================')
        setAiError(`AI から有効な値を取得できませんでした (応答: ${String(raw ?? '').slice(0, 40)}…)`)
        return
      }
      console.log('[result]', n, 'kcal')
      console.log('======================================')
      setKcal(String(n))
      setKcalMode('llm_estimate')
    } catch (err) {
      console.warn('[ai kcal] generate failed:', err)
      console.log('======================================')
      setAiError(err?.message ?? String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const onSave = async () => {
    if (busy) return
    if (!name.trim()) {
      Alert.alert('入力エラー', '食品名は必須です。')
      return
    }
    setBusy(true)
    try {
      // kcal_source の決定:
      //   - 'manual'        : kcal を手で打ち変えた
      //   - 'llm_estimate'  : AI 推定ボタンで埋めた
      //   - 'auto' + DB ヒット : 'db'
      //   - 'auto' + ヒットなし : null
      const kcalSource =
        kcalMode === 'manual'
          ? 'manual'
          : kcalMode === 'llm_estimate'
            ? 'llm_estimate'
            : recomputed != null
              ? 'db'
              : null
      await updateFoodLogItem(id, {
        eaten_at: eatenAt.toISOString(),
        name: name.trim(),
        quantity: toNum(quantity),
        unit: unit.trim() || null,
        portion,
        kcal: toNum(kcal),
        kcal_source: kcalSource,
      })
      navigation.goBack()
    } catch (err) {
      Alert.alert('保存エラー', err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <View style={styles.centerWrap}>
        <ActivityIndicator size="large" color={colors.lightPurple} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
        <Field label="食品名">
          <FoodNameInput
            value={name}
            onChangeText={setName}
            onCommit={(picked, _food, suggestedUnit) => {
              setName(picked)
              // 既定単位が引けたら一緒に上書き (タップ時のみ)。手で打った単位は尊重する。
              if (suggestedUnit) setUnit(suggestedUnit)
            }}
            placeholder="例: ごはん"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <View style={styles.row}>
          <View style={styles.flex1}>
            <Field label="数量">
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="decimal-pad"
                placeholder="例: 1"
                placeholderTextColor={colors.gray}
                style={styles.input}
              />
            </Field>
          </View>
          <View style={[styles.flex1, { marginLeft: 12 }]}>
            <Field label="単位">
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="例: 杯"
                placeholderTextColor={colors.gray}
                style={styles.input}
              />
            </Field>
          </View>
        </View>

        <Field label="量">
          <View style={styles.segment}>
            <SegmentButton label="少なめ" active={portion === 'small'} onPress={() => setPortion('small')} />
            <SegmentButton label="並" active={portion === 'normal'} onPress={() => setPortion('normal')} />
            <SegmentButton label="多め" active={portion === 'large'} onPress={() => setPortion('large')} />
          </View>
        </Field>

        <Field label="カロリー (kcal)">
          <View style={styles.kcalRow}>
            <TextInput
              value={kcal}
              onChangeText={(v) => {
                setKcal(v)
                setKcalMode('manual')
              }}
              keyboardType="number-pad"
              placeholder="例: 250"
              placeholderTextColor={colors.gray}
              style={[styles.input, styles.kcalInput]}
            />
            <Pressable
              onPress={() => {
                setKcalMode('auto')
                if (recomputed != null) setKcal(String(recomputed))
              }}
              disabled={recomputed == null}
              style={({ pressed }) => [
                styles.recalcBtn,
                recomputed == null && styles.recalcBtnDisabled,
                pressed && recomputed != null && styles.btnPressed,
              ]}
            >
              <Text
                style={[
                  styles.recalcBtnText,
                  recomputed == null && styles.recalcBtnTextDisabled,
                ]}
              >
                再計算
              </Text>
            </Pressable>
            <Pressable
              onPress={onPressAiEstimate}
              disabled={aiBusy || !llm?.isReady}
              style={({ pressed }) => [
                styles.recalcBtn,
                styles.aiBtn,
                (aiBusy || !llm?.isReady) && styles.recalcBtnDisabled,
                pressed && !aiBusy && llm?.isReady && styles.btnPressed,
              ]}
            >
              {aiBusy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text
                  style={[
                    styles.recalcBtnText,
                    !llm?.isReady && styles.recalcBtnTextDisabled,
                  ]}
                >
                  AI推定
                </Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.kcalHint}>
            {aiError
              ? `※ ${aiError}`
              : kcalMode === 'llm_estimate'
                ? 'AI 推定値です（参考目安）'
                : kcalMode === 'auto'
                  ? recomputed != null
                    ? '数量・単位・量に応じて自動再計算しています'
                    : '一致する食品が見つかりません。「AI推定」で推定値を入れられます'
                  : recomputed != null
                    ? `手入力中（自動値: ${recomputed} kcal → 「再計算」で反映）`
                    : '手入力中'}
          </Text>
        </Field>

        <Field label="日時">
          <Pressable
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [styles.input, styles.dateButton, pressed && styles.btnPressed]}
          >
            <Text style={styles.dateText}>{formatDateTime(eatenAt.toISOString())}</Text>
          </Pressable>
        </Field>

        <DateTimePickerModal
          isVisible={pickerVisible}
          mode="datetime"
          date={eatenAt}
          onConfirm={(d) => {
            setEatenAt(d)
            setPickerVisible(false)
          }}
          onCancel={() => setPickerVisible(false)}
          locale="ja"
          confirmTextIOS="決定"
          cancelTextIOS="キャンセル"
        />

        <Pressable
          onPress={onSave}
          disabled={busy}
          style={({ pressed }) => [styles.saveBtn, (pressed || busy) && styles.btnPressed]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>保存</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const Field = ({ label, children }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
  </View>
)

const SegmentButton = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.segmentBtn,
      active && styles.segmentBtnActive,
      pressed && styles.btnPressed,
    ]}
  >
    <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{label}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  flex1: { flex: 1 },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  root: { padding: 20, paddingBottom: 60 },
  row: { flexDirection: 'row' },
  field: { marginBottom: 14 },
  fieldLabel: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#dcd9ec',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    backgroundColor: '#fafafe',
  },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dcd9ec',
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fafafe',
  },
  segmentBtnActive: { backgroundColor: colors.lightPurple },
  segmentBtnText: { fontSize: fontSize.middle, color: colors.darkPurple },
  segmentBtnTextActive: { color: colors.white, fontWeight: '600' },
  kcalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kcalInput: { flex: 1 },
  kcalHint: { fontSize: fontSize.small, color: colors.gray, marginTop: 4 },
  recalcBtn: {
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: 8,
    backgroundColor: colors.lightPurple,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recalcBtnDisabled: { backgroundColor: '#e5e2f0' },
  recalcBtnText: { color: colors.white, fontSize: fontSize.small, fontWeight: '600' },
  recalcBtnTextDisabled: { color: colors.gray },
  aiBtn: { backgroundColor: colors.darkPurple },
  dateButton: { justifyContent: 'center' },
  dateText: { fontSize: fontSize.middle, color: colors.darkPurple },
  saveBtn: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  btnPressed: { opacity: 0.7 },
})
