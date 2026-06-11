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
  View,
} from 'react-native'
import DateTimePickerModal from 'react-native-modal-datetime-picker'
import { colors, fontSize } from '../../theme'
import { getFoodLogItem, updateFoodLogItem } from '../../db/foodLogActions'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import FoodNameInput from '../../components/FoodNameInput'
import NumericKeypadModal from '../../components/NumericKeypadModal'
import UnitChipsInput from '../../components/UnitChipsInput'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { estimateKcalForFood } from '../../utils/aiKcal'

// 食事ログ編集での単位サジェスト。 完成料理〜素材まで広めに。
const UNIT_SUGGESTIONS = ['杯', '個', '枚', '本', '玉', '皿', '食', 'g', 'ml']

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
  const [kcal, setKcal] = useState('')
  const [eatenAt, setEatenAt] = useState(new Date())
  const [pickerVisible, setPickerVisible] = useState(false)
  // 数値テンキー モーダル: open かどうかと、 起動時のフォーカス対象 ('quantity' | 'kcal')。
  const [keypad, setKeypad] = useState({ open: false, mode: 'quantity' })
  // kcal の出どころモード:
  //   - 'auto'         : DB 再計算追従 (recomputed が反映されたら kcal 上書き)
  //   - 'manual'       : ユーザー手入力 (DB 再計算を反映しない)
  //   - 'llm_estimate' : 「AI 推定」ボタンで LLM が出した値
  //   - 再計算 / AI 推定 / 手入力ボタンで切り替わる。
  const [kcalMode, setKcalMode] = useState('auto')
  // 直近の再計算結果（プレビュー用）。null = 再計算不能（マッチなし等）
  const [recomputed, setRecomputed] = useState(null)
  const recomputeSeqRef = useRef(0)
  // FoodNameInput のサジェストでユーザーが選んだ食品 (foods 行) を覚える。
  //   recompute で findBestFood の top-1 を引くと、 ユーザーが選んだ下位サジェスト
  //   (Slism の完成料理など) と別 food が拾われて kcal が空になる事故を防ぐため、
  //   選択後の最初の recompute はこちらを優先利用する。 手入力で名前が変わったら
  //   ref をクリアして findBestFood に戻す。
  const pickedFoodRef = useRef(null)
  // ロード直後の name/quantity/unit を覚えておく。 これと現在値が全て一致している
  // = 「画面に入っただけでユーザーは何も触っていない」状態。 この間は recompute の
  // setKcal をスキップし、 DB に保存された kcal を尊重する (勝手な書き換えを防ぐ)。
  // ユーザーが何か 1 フィールドでも編集すると差分が発生し、 以後は通常の auto 追従に戻る。
  const initialFieldsRef = useRef(null)
  // AI 推定の進行中フラグと最後のエラー (UI ヒント用)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPhase, setAiPhase] = useState(null) // 'swapping' | 'generating' | null
  const [aiError, setAiError] = useState(null)
  const llm = useActiveLLM()
  const { activeModel, currentRole, setCurrentRole, coachModel } = useActiveModel()
  // 非同期処理中に最新 llm を参照するための ref ミラー。
  const llmRef = useRef(llm)
  useEffect(() => {
    llmRef.current = llm
  }, [llm])

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
      setKcal(row.kcal != null ? String(row.kcal) : '')
      setEatenAt(new Date(row.eaten_at))
      // DB の kcal_source を kcalMode に復元する。 復元しないと kcalMode='auto' のまま
      // useEffect の再計算で手入力 / AI 推定値が上書きされてしまう。
      //   'manual'       → そのまま 'manual' (再計算しない)
      //   'llm_estimate' → そのまま 'llm_estimate' (再計算しない)
      //   'db' / null    → 'auto' (DB で再計算追従)
      const src = row.kcal_source ?? null
      setKcalMode(src === 'manual' || src === 'llm_estimate' ? src : 'auto')
      // ロード時点の値を覚える (useEffect で「ユーザー未編集」判定に使う)。
      initialFieldsRef.current = {
        name: row.name ?? '',
        quantity: row.quantity != null ? String(row.quantity) : '',
        unit: row.unit ?? '',
      }
    } catch (err) {
      console.warn('[editFood] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [id, navigation])

  useEffect(() => {
    load()
  }, [load])

  // name / quantity / unit 変更で kcal を再計算 (300ms デバウンス)。
  //   - findBestFood で foods 表を引き、 computeKcalFromMatch で kcal を算出
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
        // サジェストで選んだ食品名と一致するなら、 その food をそのまま使う。
        // 違ったら findBestFood の top-1 にフォールバック。
        const picked = pickedFoodRef.current
        const matched =
          picked && picked.name === name.trim()
            ? picked
            : await findBestFood(name.trim())
        const computed = computeKcalFromMatch(matched, qty, unit.trim(), name.trim())
        if (seq !== recomputeSeqRef.current) return // 古い結果は破棄
        if (computed == null) {
          setRecomputed(null)
          return
        }
        setRecomputed(computed)
        // ロード直後にユーザーが何も触っていない状態なら setKcal をスキップする。
        // DB 保存値 (前回保存時の kcal) をそのまま尊重し、 「画面に入った瞬間に
        // 値が書き換わる」 を防ぐ。 「再計算」 ボタンは recomputed != null なら
        // 押下可能なので、 ユーザーが望めば手動で反映できる。
        const initial = initialFieldsRef.current
        const untouched =
          initial != null
          && initial.name === name
          && initial.quantity === quantity
          && initial.unit === unit
        if (kcalMode === 'auto' && !untouched) setKcal(String(computed))
      } catch (e) {
        console.warn('[editFood] recompute failed:', e)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [loaded, name, quantity, unit, kcalMode])

  // 「AI 推定」ボタン: parser モデル (0.6B) では知識不足で精度低 (家系ラーメン → 370 kcal) のため、
  // 一時的に coach モデル (1.7B+) にスワップして推定。終わったら元のロールに戻す。
  const onPressAiEstimate = async () => {
    if (aiBusy) return
    setAiError(null)
    if (!llm || !llm.isReady || llm.isGenerating) {
      setAiError('AI モデルが準備中です。少し待ってから再度お試しください')
      return
    }
    const originalRole = currentRole
    const needSwap = originalRole !== 'coach'
    setAiBusy(true)
    setAiPhase(needSwap ? 'swapping' : 'generating')
    try {
      if (needSwap) {
        await setCurrentRole('coach')
        // 2 段階待機: まず isReady が false に落ちる (= スワップ開始) のを待ち、
        // 次に true に戻る (= 新モデル ready) のを待つ。 詳細は Chat.js 同等処理のコメント参照。
        const phase1Start = Date.now()
        let swapStarted = false
        while (Date.now() - phase1Start < 5_000) {
          if (!llmRef.current?.isReady) {
            swapStarted = true
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (swapStarted) {
          const phase2Start = Date.now()
          while (Date.now() - phase2Start < 30_000) {
            const cur = llmRef.current
            if (cur?.isReady && !cur?.isGenerating) break
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          if (!llmRef.current?.isReady) {
            setAiError('コーチモデルのロードがタイムアウトしました')
            return
          }
        }
        setAiPhase('generating')
      }
      // coach に repetitionPenalty を効かせる (詳細は Chat.js 同等処理のコメント参照)。
      try {
        llmRef.current?.configure({
          generationConfig: { temperature: 0.1, repetitionPenalty: 1.1 },
        })
      } catch (e) {
        console.warn('[ai kcal] configure (coach) failed:', e?.message ?? e)
      }
      const r = await estimateKcalForFood(llmRef.current, {
        name,
        quantity: toNum(quantity) ?? 1,
        unit,
        modelLabel: coachModel?.id ?? 'coach',
      })
      if (r.ok) {
        setKcal(String(r.kcal))
        setKcalMode('llm_estimate')
      } else {
        setAiError(r.error)
      }
    } finally {
      if (needSwap) {
        setCurrentRole(originalRole).catch(() => {})
      }
      setAiBusy(false)
      setAiPhase(null)
    }
  }

  const openKeypad = (mode) => setKeypad({ open: true, mode })
  const closeKeypad = () => setKeypad((s) => ({ ...s, open: false }))
  const onKeypadSubmit = ({ quantity: qNext, kcal: kNext, unit: uNext, kcalTouched, unitTouched }) => {
    // 数量が変わったら反映。
    //   - auto モードのときは数量編集後の useEffect 再計算で kcal が DB から上書きされるので、
    //     モーダル側の auto-scale 結果は無視する。
    //   - manual / llm_estimate モードのときはモーダルの auto-scale を尊重して
    //     新しい数量に応じた kcal を採用する (kcal_source は維持)。
    //   - kcalTouched=true は 「ユーザーが kcal キーを直接叩いた」 印。 この場合は
    //     'manual' モードに切り替える (空文字なら 'auto' に戻す)。
    //   - unitTouched=true は単位チップで切り替えた印。 Field 側の UnitChipsInput と
    //     同じ unit state を更新する。 useEffect が再計算を回して kcal も追従する。
    if (qNext !== quantity) setQuantity(qNext)
    if (unitTouched && uNext !== unit) setUnit(uNext)
    if (kcalTouched) {
      setKcal(kNext)
      setKcalMode(kNext === '' ? 'auto' : 'manual')
    } else if (kcalMode !== 'auto' && kNext !== kcal) {
      setKcal(kNext)
    }
    closeKeypad()
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
            onChangeText={(v) => {
              setName(v)
              // サジェスト確定後に手で名前を変えたら、 覚えていた食品行を捨てて
              // 通常の findBestFood に戻す。
              if (pickedFoodRef.current && pickedFoodRef.current.name !== v) {
                pickedFoodRef.current = null
              }
            }}
            onCommit={(picked, food, suggestedUnit) => {
              setName(picked)
              // サジェストで選ばれたまさにその food を recompute で優先利用する。
              pickedFoodRef.current = food ?? null
              // 既定単位が引けたら一緒に上書き (タップ時のみ)。手で打った単位は尊重する。
              if (suggestedUnit) setUnit(suggestedUnit)
            }}
            placeholder="例: ごはん"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <Field label="カロリー (kcal)">
          <View style={styles.kcalRow}>
            <Pressable
              onPress={() => openKeypad('kcal')}
              style={({ pressed }) => [
                styles.input,
                styles.kcalInput,
                styles.tappableInput,
                pressed && styles.btnPressed,
              ]}
            >
              <Text
                style={[
                  styles.tappableInputText,
                  !kcal && styles.tappableInputPlaceholder,
                ]}
              >
                {kcal || '例: 250'}
              </Text>
            </Pressable>
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
                <View style={styles.aiBtnBusyInner}>
                  <ActivityIndicator size="small" color={colors.white} />
                  <Text style={styles.aiBtnBusyText}>
                    {aiPhase === 'swapping' ? '読み込み中' : '推定中'}
                  </Text>
                </View>
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
                    ? '数量・単位に応じて自動再計算しています'
                    : '一致する食品が見つかりません。「AI推定」で推定値を入れられます'
                  : recomputed != null
                    ? `手入力中（自動値: ${recomputed} kcal → 「再計算」で反映）`
                    : '手入力中'}
          </Text>
        </Field>

        <View style={styles.row}>
          <View style={styles.flex1}>
            <Field label="数量">
              <Pressable
                onPress={() => openKeypad('quantity')}
                style={({ pressed }) => [
                  styles.input,
                  styles.tappableInput,
                  pressed && styles.btnPressed,
                ]}
              >
                <Text
                  style={[
                    styles.tappableInputText,
                    !quantity && styles.tappableInputPlaceholder,
                  ]}
                >
                  {quantity || '例: 1'}
                </Text>
              </Pressable>
            </Field>
          </View>
          <View style={[styles.flex1, { marginLeft: 12 }]}>
            <Field label="単位">
              <UnitChipsInput
                value={unit}
                onChangeText={setUnit}
                suggestions={UNIT_SUGGESTIONS}
                placeholder="例: 杯"
                inputStyle={styles.input}
                chipsBelow
              />
            </Field>
          </View>
        </View>

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

        <NumericKeypadModal
          visible={keypad.open}
          subtitle={name || undefined}
          initialMode={keypad.mode}
          quantityValue={quantity}
          quantityUnit={unit}
          unitSuggestions={UNIT_SUGGESTIONS}
          kcalValue={kcal}
          onSubmit={onKeypadSubmit}
          onClose={closeKeypad}
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
  // 数量 / kcal の入力枠を Pressable で代用するときに使う。
  // styles.input と同じ枠を引き継ぎつつ、 中央寄せ + 文字色を Text 側で当てる。
  tappableInput: { justifyContent: 'center', minHeight: 40 },
  tappableInputText: { fontSize: fontSize.middle, color: colors.darkPurple },
  tappableInputPlaceholder: { color: colors.gray },
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
  aiBtnBusyInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  aiBtnBusyText: { color: colors.white, fontSize: fontSize.small, fontWeight: '600', marginLeft: 4 },
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
