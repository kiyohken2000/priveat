import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import FoodNameInput from '../../components/FoodNameInput'
import { colors, fontSize } from '../../theme'
import { computeKcalFromMatch } from '../../db/search'
import {
  addRecipeIngredient,
  deleteRecipe,
  deleteRecipeIngredientRow,
  getRecipe,
  updateRecipeIngredient,
  updateRecipeMeta,
} from '../../db/recipes'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { estimateKcalForFood } from '../../utils/aiKcal'

const toNum = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}

// 1 材料行の編集状態。 DB 行と 1:1 対応するが、 文字入力中は文字列で持つ。
//   id          : 既存行なら recipe_ingredients.id、 新規追加なら null
//   tempKey     : key prop 用の一意キー (新規行は id が無いので必要)
//   removed     : true なら保存時に DELETE
//   nameDraft / qtyDraft / unitDraft / kcalDraft : 入力中文字列
//   kcalSource  : 既存値。 ユーザーが kcal を打ち変えたら 'manual' に変える
//   matchedFoodId: 既存の foods 参照 (編集時は触らない。 別 food へ振り替えるのは将来課題)
const toEditState = (ing, idx) => ({
  id: ing.id,
  tempKey: `db-${ing.id ?? idx}`,
  removed: false,
  nameDraft: ing.name ?? '',
  qtyDraft: ing.quantity != null ? String(ing.quantity) : '',
  unitDraft: ing.unit ?? '',
  kcalDraft: ing.kcal != null ? String(ing.kcal) : '',
  kcalSource: ing.kcal_source ?? null,
  matchedFoodId: ing.matched_food_id ?? null,
  // 初期値スナップショット (差分判定用)。 reload 後の比較なので浅いコピーで十分。
  initial: {
    name: ing.name ?? '',
    quantity: ing.quantity ?? null,
    unit: ing.unit ?? '',
    kcal: ing.kcal ?? null,
    kcalSource: ing.kcal_source ?? null,
  },
})

const blankIngredient = () => ({
  id: null,
  tempKey: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  removed: false,
  nameDraft: '',
  qtyDraft: '',
  unitDraft: 'g',
  kcalDraft: '',
  kcalSource: null,
  matchedFoodId: null,
  initial: null,
})

export default function RecipeEditScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const { id: recipeId } = route.params

  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [servingsDraft, setServingsDraft] = useState('')
  const [initialName, setInitialName] = useState('')
  const [initialServings, setInitialServings] = useState(null)
  const [ingredients, setIngredients] = useState([])

  // 1 行だけの AI 推定中フラグ (= 行の tempKey)。 同時並行はさせない。
  const [aiBusyKey, setAiBusyKey] = useState(null)
  const [aiPhase, setAiPhase] = useState(null) // 'swapping' | 'generating' | null
  const llm = useActiveLLM()
  const { currentRole, setCurrentRole, coachModel } = useActiveModel()
  // 非同期処理中に最新 llm を参照するため (Chat / EditFoodScreen と同じ)
  const llmRef = useRef(llm)
  useEffect(() => {
    llmRef.current = llm
  }, [llm])

  const load = useCallback(async () => {
    try {
      const r = await getRecipe(recipeId)
      if (!r) {
        Alert.alert('エラー', '対象のレシピが見つかりません。')
        navigation.goBack()
        return
      }
      setNameDraft(r.name ?? '')
      setServingsDraft(r.servings != null ? String(r.servings) : '')
      setInitialName(r.name ?? '')
      setInitialServings(r.servings ?? null)
      setIngredients((r.ingredients ?? []).map(toEditState))
    } catch (err) {
      console.warn('[recipeEdit] load error:', err)
      Alert.alert('エラー', err?.message ?? String(err))
    } finally {
      setLoaded(true)
    }
  }, [recipeId, navigation])

  useEffect(() => {
    load()
  }, [load])

  const updateIng = useCallback((tempKey, patch) => {
    setIngredients((prev) =>
      prev.map((ing) => (ing.tempKey === tempKey ? { ...ing, ...patch } : ing)),
    )
  }, [])

  // FoodNameInput のサジェストタップ時。 名前確定に加えて:
  //   - 単位が空なら portionWeights 由来の既定単位を埋める
  //   - 数量と単位が揃っていれば computeKcalFromMatch で kcal を上書きし
  //     kcal_source='db' に戻す (元が manual / llm_estimate でも上書き OK
  //     な操作 = ユーザーが明示的に食品を選び直したため)
  const onPickIngredientFood = useCallback((tempKey, picked, food, suggestedUnit) => {
    setIngredients((prev) =>
      prev.map((ing) => {
        if (ing.tempKey !== tempKey) return ing
        const nextUnit = ing.unitDraft.trim() ? ing.unitDraft : (suggestedUnit ?? ing.unitDraft)
        const qty = toNum(ing.qtyDraft)
        let nextKcalDraft = ing.kcalDraft
        let nextKcalSource = ing.kcalSource
        if (food && qty != null && nextUnit.trim()) {
          const k = computeKcalFromMatch(food, qty, nextUnit.trim(), picked)
          if (k != null) {
            nextKcalDraft = String(k)
            nextKcalSource = 'db'
          }
        }
        return {
          ...ing,
          nameDraft: picked,
          unitDraft: nextUnit,
          kcalDraft: nextKcalDraft,
          kcalSource: nextKcalSource,
          matchedFoodId: food?.id ?? ing.matchedFoodId,
        }
      }),
    )
  }, [])

  // 1 行の kcal を coach モデルで推定する。 EditFoodScreen.onPressAiEstimate と
  // 同じ 2 段階スワップ (isReady→false 待ち → 新モデル ready 待ち)。
  const onAiEstimate = useCallback(
    async (tempKey) => {
      if (aiBusyKey) return
      if (!llm || !llm.isReady || llm.isGenerating) {
        Alert.alert('AI モデルが準備中', '少し待ってから再度お試しください。')
        return
      }
      const target = ingredients.find((ing) => ing.tempKey === tempKey)
      if (!target) return
      const name = target.nameDraft.trim()
      const qty = toNum(target.qtyDraft)
      const unit = target.unitDraft.trim() || '個'
      if (!name) {
        Alert.alert('入力エラー', '材料名が空です。')
        return
      }
      if (qty == null || qty <= 0) {
        Alert.alert('入力エラー', '数量を入力してください。')
        return
      }

      const originalRole = currentRole
      const needSwap = originalRole !== 'coach'
      setAiBusyKey(tempKey)
      setAiPhase(needSwap ? 'swapping' : 'generating')
      try {
        if (needSwap) {
          await setCurrentRole('coach')
          const phase1Start = Date.now()
          let swapStarted = false
          while (Date.now() - phase1Start < 5_000) {
            if (!llmRef.current?.isReady) {
              swapStarted = true
              break
            }
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          if (swapStarted) {
            const phase2Start = Date.now()
            while (Date.now() - phase2Start < 30_000) {
              const cur = llmRef.current
              if (cur?.isReady && !cur?.isGenerating) break
              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
            if (!llmRef.current?.isReady) {
              throw new Error('コーチモデルのロードがタイムアウトしました')
            }
          }
          setAiPhase('generating')
        }
        // coach に repetitionPenalty を効かせる (Chat / EditFoodScreen 同等)
        try {
          if (llmRef.current?.configure) {
            llmRef.current.configure({
              generationConfig: { temperature: 0.1, repetitionPenalty: 1.1 },
            })
          }
        } catch (e) {
          console.warn('[recipeEdit] configure (coach) failed:', e?.message ?? e)
        }
        const r = await estimateKcalForFood(llmRef.current, {
          name,
          quantity: qty,
          unit,
          modelLabel: coachModel?.id ?? 'coach',
          mode: 'ingredient',
        })
        if (r.ok) {
          updateIng(tempKey, {
            kcalDraft: String(r.kcal),
            kcalSource: 'llm_estimate',
          })
        } else {
          Alert.alert('AI 推定に失敗', r.error ?? '不明なエラー')
        }
      } catch (err) {
        Alert.alert('AI 推定エラー', err?.message ?? String(err))
      } finally {
        if (needSwap) {
          setCurrentRole(originalRole).catch(() => {})
        }
        setAiBusyKey(null)
        setAiPhase(null)
      }
    },
    [aiBusyKey, llm, ingredients, currentRole, setCurrentRole, coachModel, updateIng],
  )

  const removeIng = useCallback((tempKey) => {
    setIngredients((prev) => {
      // 新規行 (id=null) は単に配列から消す。 既存行は removed フラグで残す。
      return prev
        .map((ing) =>
          ing.tempKey === tempKey ? { ...ing, removed: true } : ing,
        )
        .filter((ing) => !(ing.id == null && ing.removed))
    })
  }, [])

  const addIng = useCallback(() => {
    setIngredients((prev) => [...prev, blankIngredient()])
  }, [])

  const visibleIngredients = useMemo(
    () => ingredients.filter((ing) => !ing.removed),
    [ingredients],
  )

  // プレビュー合計 (未確定 kcal があれば null 表示)
  const preview = useMemo(() => {
    const kcalNums = visibleIngredients.map((ing) => toNum(ing.kcalDraft))
    const hasUnknown = kcalNums.some((k) => k == null)
    const totalKcal = hasUnknown ? null : kcalNums.reduce((s, k) => s + (k ?? 0), 0)
    const srv = toNum(servingsDraft)
    const kcalPerServing =
      totalKcal != null && srv != null && srv > 0
        ? Math.round(totalKcal / srv)
        : null
    return { totalKcal, kcalPerServing, hasUnknown }
  }, [visibleIngredients, servingsDraft])

  const onSave = async () => {
    if (saving) return
    const name = nameDraft.trim()
    if (!name) {
      Alert.alert('入力エラー', 'レシピ名は必須です。')
      return
    }
    const srv = toNum(servingsDraft)
    if (srv == null || srv <= 0) {
      Alert.alert('入力エラー', '食数は 1 以上で入力してください。')
      return
    }
    // 材料が 1 件もない (全て削除) 状態での保存は意味が無いので止める。
    if (visibleIngredients.length === 0) {
      Alert.alert(
        '保存できません',
        '材料が空です。 行を追加するか、 レシピごと削除してください。',
      )
      return
    }
    for (const ing of visibleIngredients) {
      if (!ing.nameDraft.trim()) {
        Alert.alert('入力エラー', '材料名が空の行があります。')
        return
      }
    }

    setSaving(true)
    try {
      // 1. レシピ本体の差分があれば更新 (servings 変更は totals 再計算をトリガーする)
      const metaPatch = {}
      if (name !== initialName) metaPatch.name = name
      if (srv !== initialServings) metaPatch.servings = srv
      if (Object.keys(metaPatch).length > 0) {
        await updateRecipeMeta(recipeId, metaPatch)
      }

      // 2. 削除された既存行を先に消す (合計再計算の重複を抑える)
      for (const ing of ingredients) {
        if (ing.removed && ing.id != null) {
          // eslint-disable-next-line no-await-in-loop
          await deleteRecipeIngredientRow(ing.id)
        }
      }

      // 3. 残った行を update / add
      for (const ing of visibleIngredients) {
        const nameVal = ing.nameDraft.trim()
        const qty = toNum(ing.qtyDraft)
        const unit = ing.unitDraft.trim() || null
        const kcal = toNum(ing.kcalDraft)
        if (ing.id == null) {
          // eslint-disable-next-line no-await-in-loop
          await addRecipeIngredient(recipeId, {
            name: nameVal,
            quantity: qty,
            unit,
            kcal,
            kcalSource: kcal != null ? 'manual' : null,
          })
        } else {
          const initial = ing.initial ?? {}
          const patch = {}
          if (nameVal !== initial.name) patch.name = nameVal
          if (qty !== initial.quantity) patch.quantity = qty
          if ((unit ?? '') !== (initial.unit ?? '')) patch.unit = unit
          if (kcal !== initial.kcal) {
            patch.kcal = kcal
            // 手入力で変更したことを残す。 元 'db' / 'llm_estimate' どれでも上書き。
            patch.kcalSource = kcal == null ? null : 'manual'
          }
          if (Object.keys(patch).length > 0) {
            // eslint-disable-next-line no-await-in-loop
            await updateRecipeIngredient(ing.id, patch)
          }
        }
      }
      navigation.goBack()
    } catch (err) {
      console.warn('[recipeEdit] save failed:', err)
      Alert.alert('保存エラー', err?.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDeleteRecipe = () => {
    if (deleting) return
    Alert.alert(
      'このレシピを削除しますか?',
      `「${initialName}」を削除します。 過去の食事ログは残りますが、 以後の自動マッチには使われなくなります。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            try {
              await deleteRecipe(recipeId)
              navigation.goBack()
            } catch (err) {
              console.warn('[recipeEdit] delete failed:', err)
              Alert.alert('削除エラー', err?.message ?? String(err))
              setDeleting(false)
            }
          },
        },
      ],
    )
  }

  if (!loaded) {
    return (
      <View style={styles.center}>
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
        <Field label="レシピ名">
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="例: 無水カレー"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <Field label="食数">
          <View style={styles.servingsRow}>
            <TextInput
              value={servingsDraft}
              onChangeText={setServingsDraft}
              keyboardType="decimal-pad"
              placeholder="例: 5"
              placeholderTextColor={colors.gray}
              style={[styles.input, styles.servingsInput]}
            />
            <Text style={styles.servingsUnit}>食分</Text>
          </View>
        </Field>

        <Text style={styles.sectionTitle}>材料</Text>
        {visibleIngredients.map((ing) => (
          <View key={ing.tempKey} style={styles.ingCard}>
            <FoodNameInput
              value={ing.nameDraft}
              onChangeText={(v) => updateIng(ing.tempKey, { nameDraft: v })}
              onCommit={(picked, food, suggestedUnit) => onPickIngredientFood(ing.tempKey, picked, food, suggestedUnit)}
              placeholder="材料名"
              placeholderTextColor={colors.gray}
              style={[styles.input, styles.ingName]}
            />
            <View style={styles.ingRow}>
              <View style={styles.flex1}>
                <Text style={styles.subLabel}>数量</Text>
                <TextInput
                  value={ing.qtyDraft}
                  onChangeText={(v) => updateIng(ing.tempKey, { qtyDraft: v })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  style={styles.input}
                />
              </View>
              <View style={[styles.flex1, styles.gap]}>
                <Text style={styles.subLabel}>単位</Text>
                <TextInput
                  value={ing.unitDraft}
                  onChangeText={(v) => updateIng(ing.tempKey, { unitDraft: v })}
                  placeholder="g"
                  placeholderTextColor={colors.gray}
                  style={styles.input}
                />
              </View>
              <View style={[styles.flex1, styles.gap]}>
                <Text style={styles.subLabel}>kcal</Text>
                <TextInput
                  value={ing.kcalDraft}
                  onChangeText={(v) => updateIng(ing.tempKey, { kcalDraft: v })}
                  keyboardType="number-pad"
                  placeholder="—"
                  placeholderTextColor={colors.gray}
                  style={styles.input}
                />
              </View>
            </View>
            <View style={styles.ingFooter}>
              <Text style={styles.kcalSourceLabel}>
                {ing.kcalSource === 'manual'
                  ? '手入力'
                  : ing.kcalSource === 'llm_estimate'
                    ? 'AI 推定'
                    : ing.kcalSource === 'db'
                      ? '食品 DB'
                      : '未確定'}
              </Text>
              <View style={styles.ingFooterBtns}>
                <Pressable
                  onPress={() => onAiEstimate(ing.tempKey)}
                  disabled={aiBusyKey != null || !llm?.isReady}
                  style={({ pressed }) => [
                    styles.aiBtn,
                    (aiBusyKey != null || !llm?.isReady) && styles.btnDisabled,
                    pressed && aiBusyKey == null && llm?.isReady && styles.btnPressed,
                  ]}
                >
                  {aiBusyKey === ing.tempKey ? (
                    <View style={styles.aiBtnBusyInner}>
                      <ActivityIndicator size="small" color={colors.white} />
                      <Text style={styles.aiBtnBusyText}>
                        {aiPhase === 'swapping' ? '読込中' : '推定中'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.aiBtnText}>AI 推定</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => removeIng(ing.tempKey)}
                  disabled={aiBusyKey != null}
                  style={({ pressed }) => [
                    styles.removeBtn,
                    pressed && aiBusyKey == null && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.removeBtnText}>削除</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}

        <Pressable
          onPress={addIng}
          style={({ pressed }) => [styles.addBtn, pressed && styles.btnPressed]}
        >
          <Text style={styles.addBtnText}>＋ 材料を追加</Text>
        </Pressable>

        <View style={styles.totalBox}>
          <Text style={styles.totalLabel}>1食あたり</Text>
          <Text style={styles.totalValue}>
            {preview.kcalPerServing == null
              ? '— kcal'
              : `${preview.kcalPerServing} kcal`}
            {preview.totalKcal != null
              ? `  (合計 ${preview.totalKcal} kcal)`
              : ''}
          </Text>
        </View>
        {preview.hasUnknown ? (
          <Text style={styles.hint}>
            ※ kcal が未入力の材料があるため、 1 食あたり kcal は保存後に「— kcal」になります
          </Text>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={saving || deleting || aiBusyKey != null}
          style={({ pressed }) => [
            styles.saveBtn,
            (pressed || saving || deleting || aiBusyKey != null) && styles.btnPressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>保存</Text>
          )}
        </Pressable>

        <Pressable
          onPress={onDeleteRecipe}
          disabled={saving || deleting || aiBusyKey != null}
          style={({ pressed }) => [
            styles.deleteRecipeBtn,
            (pressed || saving || deleting || aiBusyKey != null) && styles.btnPressed,
          ]}
        >
          {deleting ? (
            <ActivityIndicator color={colors.redPrimary} />
          ) : (
            <Text style={styles.deleteRecipeBtnText}>このレシピを削除</Text>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  root: { padding: 20, paddingBottom: 60 },
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
  servingsRow: { flexDirection: 'row', alignItems: 'center' },
  servingsInput: { flex: 1, marginRight: 8 },
  servingsUnit: { fontSize: fontSize.middle, color: colors.gray },
  sectionTitle: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    marginTop: 8,
    marginBottom: 8,
  },
  ingCard: {
    backgroundColor: '#fafafe',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ecebf3',
  },
  ingName: { marginBottom: 8 },
  ingRow: { flexDirection: 'row' },
  flex1: { flex: 1 },
  gap: { marginLeft: 8 },
  subLabel: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 2,
  },
  ingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  kcalSourceLabel: {
    fontSize: fontSize.small,
    color: colors.gray,
  },
  ingFooterBtns: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: colors.darkPurple,
    marginRight: 6,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBtnText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
  },
  aiBtnBusyInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBtnBusyText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
    marginLeft: 4,
  },
  btnDisabled: { opacity: 0.5 },
  removeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0eef7',
  },
  removeBtnText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  addBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lightPurple,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  addBtnText: {
    fontSize: fontSize.small,
    color: colors.lightPurple,
    fontWeight: '600',
  },
  totalBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.lightGrayPurple,
    borderRadius: 10,
  },
  totalLabel: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
  },
  totalValue: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
  },
  hint: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 6,
  },
  saveBtn: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  deleteRecipeBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.redPrimary,
    backgroundColor: colors.white,
  },
  deleteRecipeBtnText: {
    color: colors.redPrimary,
    fontSize: fontSize.middle,
    fontWeight: '600',
  },
  btnPressed: { opacity: 0.7 },
})
