import { useNavigation, useRoute } from '@react-navigation/native'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../../theme'
import {
  deleteProductRow,
  getProduct,
  insertProductManual,
  updateProduct,
} from '../../db/products'
import { captureFromCamera, pickFromLibrary, runOcr } from '../chat/imageOcr'
import { parseLabelText } from '../chat/ocrParsers'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { estimateUnitForFood } from '../../utils/aiKcal'
import { resolveOcrImageUri } from '../../utils/persistImage'

const toNum = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}

const toStr = (v) => (v == null ? '' : String(v))

export default function ProductEditScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const productId = route.params?.id ?? null
  const isNew = productId == null

  const [loaded, setLoaded] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [source, setSource] = useState(isNew ? 'manual' : null)
  const [imageUri, setImageUri] = useState(null)
  // 新規モードで撮影/選択した画像 URI (まだ documentDirectory にコピーされていない)。
  // 保存時に insertProductManual に渡し、 そちらで persistOcrImage して永続化する。
  const [tempImageUri, setTempImageUri] = useState(null)
  const [createdAt, setCreatedAt] = useState(null)

  // 単位 AI 推定の busy 状態 (2 段階モデルスワップ: 'swapping' → 'generating')
  const [unitAiBusy, setUnitAiBusy] = useState(false)
  const [unitAiPhase, setUnitAiPhase] = useState(null)
  const llm = useActiveLLM()
  const { currentRole, setCurrentRole, coachModel } = useActiveModel()
  const llmRef = useRef(llm)
  useEffect(() => { llmRef.current = llm }, [llm])

  const [nameDraft, setNameDraft] = useState('')
  const [servingDescDraft, setServingDescDraft] = useState('')
  const [kcalDraft, setKcalDraft] = useState('')
  const [proteinDraft, setProteinDraft] = useState('')
  const [fatDraft, setFatDraft] = useState('')
  const [carbDraft, setCarbDraft] = useState('')
  const [saltDraft, setSaltDraft] = useState('')
  const [barcodeDraft, setBarcodeDraft] = useState('')

  const load = useCallback(async () => {
    if (isNew) return
    try {
      const p = await getProduct(productId)
      if (!p) {
        Alert.alert('エラー', '対象のマイ食品が見つかりません。')
        navigation.goBack()
        return
      }
      setNameDraft(p.name ?? '')
      setServingDescDraft(toStr(p.serving_desc))
      setKcalDraft(toStr(p.kcal))
      setProteinDraft(toStr(p.protein))
      setFatDraft(toStr(p.fat))
      setCarbDraft(toStr(p.carb))
      setSaltDraft(toStr(p.salt))
      setBarcodeDraft(toStr(p.barcode))
      setSource(p.source ?? null)
      setImageUri(p.image_uri ?? null)
      setCreatedAt(p.created_at ?? null)
    } catch (err) {
      console.warn('[productEdit] load error:', err)
      Alert.alert('エラー', err?.message ?? String(err))
    } finally {
      setLoaded(true)
    }
  }, [productId, isNew, navigation])

  useEffect(() => {
    load()
  }, [load])

  // 撮影/ライブラリで取得した画像を OCR → parseLabelText に流し、 抽出できた
  // 栄養成分を state にマージする。 OCR 失敗 or 抽出ゼロでもプレビュー画像は残し、
  // ユーザーが手で打ち直せる状態にする。 名前は OCR では取れないのでユーザー入力依存。
  const runLabelOcrPipeline = useCallback(async (uri) => {
    setTempImageUri(uri)
    setOcrBusy(true)
    try {
      const res = await runOcr(uri)
      const parsed = parseLabelText(res?.text ?? '')
      if (!parsed) {
        Alert.alert(
          'ラベルを読み取れませんでした',
          '画像は登録されますが、 栄養成分は手で入力してください。',
        )
        return
      }
      if (parsed.kcal != null) setKcalDraft(String(parsed.kcal))
      if (parsed.protein != null) setProteinDraft(String(parsed.protein))
      if (parsed.fat != null) setFatDraft(String(parsed.fat))
      if (parsed.carb != null) setCarbDraft(String(parsed.carb))
      if (parsed.salt != null) setSaltDraft(String(parsed.salt))
    } catch (err) {
      console.warn('[productEdit] OCR failed:', err)
      Alert.alert('OCR エラー', err?.message ?? String(err))
    } finally {
      setOcrBusy(false)
    }
  }, [])

  const onPressCapture = useCallback(async () => {
    if (ocrBusy || saving) return
    try {
      const uri = await captureFromCamera()
      if (!uri) return
      await runLabelOcrPipeline(uri)
    } catch (err) {
      Alert.alert('カメラエラー', err?.message ?? String(err))
    }
  }, [ocrBusy, saving, runLabelOcrPipeline])

  const onPressPickFromLibrary = useCallback(async () => {
    if (ocrBusy || saving) return
    try {
      const uri = await pickFromLibrary()
      if (!uri) return
      await runLabelOcrPipeline(uri)
    } catch (err) {
      Alert.alert('画像選択エラー', err?.message ?? String(err))
    }
  }, [ocrBusy, saving, runLabelOcrPipeline])

  const onClearTempImage = useCallback(() => {
    if (ocrBusy || saving) return
    setTempImageUri(null)
  }, [ocrBusy, saving])

  // 単位を AI に推定させる。 名前のみを入力にして 1 単語を返してもらう。
  // RecipeEditScreen.onAiEstimate と同じ 2 段階モデルスワップ動線。
  const onEstimateUnit = useCallback(async () => {
    if (unitAiBusy) return
    if (!llm || !llm.isReady || llm.isGenerating) {
      Alert.alert('AI モデルが準備中', '少し待ってから再度お試しください。')
      return
    }
    const name = nameDraft.trim()
    if (!name) {
      Alert.alert('入力エラー', '食品名が空です。')
      return
    }
    const originalRole = currentRole
    const needSwap = originalRole !== 'coach'
    setUnitAiBusy(true)
    setUnitAiPhase(needSwap ? 'swapping' : 'generating')
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
        setUnitAiPhase('generating')
      }
      try {
        if (llmRef.current?.configure) {
          llmRef.current.configure({
            generationConfig: { temperature: 0.1, repetitionPenalty: 1.1 },
          })
        }
      } catch (e) {
        console.warn('[productEdit] configure (coach) failed:', e?.message ?? e)
      }
      const r = await estimateUnitForFood(llmRef.current, {
        name,
        modelLabel: coachModel?.id ?? 'coach',
      })
      if (r.ok) {
        setServingDescDraft(r.unit)
      } else {
        Alert.alert('AI 推定に失敗', r.error ?? '不明なエラー')
      }
    } catch (err) {
      Alert.alert('AI 推定エラー', err?.message ?? String(err))
    } finally {
      if (needSwap) {
        setCurrentRole(originalRole).catch(() => {})
      }
      setUnitAiBusy(false)
      setUnitAiPhase(null)
    }
  }, [unitAiBusy, llm, nameDraft, currentRole, setCurrentRole, coachModel])

  const onSave = async () => {
    if (saving) return
    const name = nameDraft.trim()
    if (!name) {
      Alert.alert('入力エラー', '食品名は必須です。')
      return
    }
    const kcal = toNum(kcalDraft)
    if (kcal == null) {
      Alert.alert('入力エラー', 'kcal は必須です (1 単位あたり)。')
      return
    }
    setSaving(true)
    try {
      const fields = {
        name,
        kcal,
        protein: toNum(proteinDraft),
        fat: toNum(fatDraft),
        carb: toNum(carbDraft),
        salt: toNum(saltDraft),
        serving_desc: servingDescDraft.trim() || null,
        barcode: barcodeDraft.trim() || null,
      }
      if (isNew) {
        await insertProductManual(fields, {
          imageUri: tempImageUri,
          // 画像付きで登録された場合は OCR 補助があった扱いとして source='label_ocr'。
          // 画像なしの純粋な手入力は 'manual'。
          source: tempImageUri ? 'label_ocr' : 'manual',
        })
      } else {
        await updateProduct(productId, fields)
      }
      navigation.goBack()
    } catch (err) {
      console.warn('[productEdit] save failed:', err)
      Alert.alert('保存エラー', err?.message ?? String(err))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    if (deleting || isNew) return
    Alert.alert(
      'このマイ食品を削除しますか?',
      `「${nameDraft}」を削除します。 過去の食事ログは残りますが、 以後はサジェストに出なくなります。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            try {
              await deleteProductRow(productId)
              navigation.goBack()
            } catch (err) {
              console.warn('[productEdit] delete failed:', err)
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
        {imageUri ? (
          <View style={styles.imageBox}>
            <Image source={{ uri: resolveOcrImageUri(imageUri) }} style={styles.image} resizeMode="cover" />
            <Text style={styles.imageHint}>登録時のラベル画像</Text>
          </View>
        ) : null}

        {isNew ? (
          tempImageUri ? (
            <View style={styles.imageBox}>
              <Image source={{ uri: tempImageUri }} style={styles.image} resizeMode="cover" />
              {ocrBusy ? (
                <View style={styles.ocrOverlay}>
                  <ActivityIndicator color={colors.white} />
                  <Text style={styles.ocrOverlayText}>ラベルを読取中…</Text>
                </View>
              ) : null}
              <View style={styles.imageActions}>
                <Pressable
                  onPress={onClearTempImage}
                  disabled={ocrBusy || saving}
                  style={({ pressed }) => [
                    styles.imageActionBtn,
                    (pressed || ocrBusy || saving) && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.imageActionText}>画像を外す</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.ocrEntry}>
              <Text style={styles.ocrEntryHint}>
                栄養成分表示を撮影/選択すると、 kcal・P/F/C を自動で読み取ります
                (名前は手入力)。
              </Text>
              <View style={styles.ocrButtonsRow}>
                <Pressable
                  onPress={onPressCapture}
                  disabled={ocrBusy || saving}
                  style={({ pressed }) => [
                    styles.ocrBtn,
                    (pressed || ocrBusy || saving) && styles.btnPressed,
                  ]}
                >
                  <FontIcon name="camera" size={16} color={colors.white} style={styles.ocrBtnIcon} />
                  <Text style={styles.ocrBtnText}>ラベルを撮影</Text>
                </Pressable>
                <Pressable
                  onPress={onPressPickFromLibrary}
                  disabled={ocrBusy || saving}
                  style={({ pressed }) => [
                    styles.ocrBtn,
                    styles.ocrBtnSecondary,
                    (pressed || ocrBusy || saving) && styles.btnPressed,
                  ]}
                >
                  <FontIcon name="picture-o" size={16} color={colors.darkPurple} style={styles.ocrBtnIcon} />
                  <Text style={[styles.ocrBtnText, styles.ocrBtnTextSecondary]}>写真から選ぶ</Text>
                </Pressable>
              </View>
            </View>
          )
        ) : null}

        <Field label="食品名">
          <TextInput
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="例: セブンプレミアム サラダチキン"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <Field label="1 単位の表示 (任意)">
          <View style={styles.unitRow}>
            <TextInput
              value={servingDescDraft}
              onChangeText={setServingDescDraft}
              placeholder="例: 個 / 袋 / 本 / g / グラム"
              placeholderTextColor={colors.gray}
              style={[styles.input, styles.flex1]}
            />
            <Pressable
              onPress={onEstimateUnit}
              disabled={unitAiBusy || saving || !llm?.isReady}
              style={({ pressed }) => [
                styles.unitAiBtn,
                (unitAiBusy || saving || !llm?.isReady) && styles.btnDisabled,
                pressed && !unitAiBusy && !saving && llm?.isReady && styles.btnPressed,
              ]}
            >
              {unitAiBusy ? (
                <View style={styles.unitAiBusyInner}>
                  <ActivityIndicator size="small" color={colors.white} />
                  <Text style={styles.unitAiBtnText}>
                    {unitAiPhase === 'swapping' ? '読込中' : '推定中'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.unitAiBtnText}>AI 推定</Text>
              )}
            </Pressable>
          </View>
          <Text style={styles.unitHint}>
            商品 1 パックではなく、 自分が普段 1 回で食べる量を「1 単位」 にすると入力が楽です。{'\n'}
            例: 400g パックのヨーグルトを毎回 200g 食べるなら、 表示を「食」 にして 1 食 = 200g 分の kcal を入れる
            (食事記録で「ヨーグルト 1食」 = 200g 分、 「0.5食」 = 100g 分 として計算)。
          </Text>
        </Field>

        <Field label="kcal (1 単位あたり)">
          <TextInput
            value={kcalDraft}
            onChangeText={setKcalDraft}
            keyboardType="decimal-pad"
            placeholder="例: 113"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <View style={styles.pfcRow}>
          <View style={styles.pfcCell}>
            <Text style={styles.fieldLabel}>たんぱく質 (g)</Text>
            <TextInput
              value={proteinDraft}
              onChangeText={setProteinDraft}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
          </View>
          <View style={styles.pfcCell}>
            <Text style={styles.fieldLabel}>脂質 (g)</Text>
            <TextInput
              value={fatDraft}
              onChangeText={setFatDraft}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
          </View>
        </View>
        <View style={styles.pfcRow}>
          <View style={styles.pfcCell}>
            <Text style={styles.fieldLabel}>炭水化物 (g)</Text>
            <TextInput
              value={carbDraft}
              onChangeText={setCarbDraft}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
          </View>
          <View style={styles.pfcCell}>
            <Text style={styles.fieldLabel}>食塩相当量 (g)</Text>
            <TextInput
              value={saltDraft}
              onChangeText={setSaltDraft}
              keyboardType="decimal-pad"
              placeholder="—"
              placeholderTextColor={colors.gray}
              style={styles.input}
            />
          </View>
        </View>

        <Field label="バーコード (任意)">
          <TextInput
            value={barcodeDraft}
            onChangeText={setBarcodeDraft}
            keyboardType="number-pad"
            placeholder="例: 4901234567890"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        {!isNew ? (
          <Text style={styles.metaLine}>
            登録元: {source === 'manual' ? '手入力' : source === 'label_ocr' ? 'ラベル OCR' : (source ?? '—')}
            {createdAt ? `  ·  ${new Date(createdAt).toLocaleString('ja-JP')}` : ''}
          </Text>
        ) : null}

        <Pressable
          onPress={onSave}
          disabled={saving || deleting}
          style={({ pressed }) => [
            styles.saveBtn,
            (pressed || saving || deleting) && styles.btnPressed,
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>{isNew ? '登録' : '保存'}</Text>
          )}
        </Pressable>

        {!isNew ? (
          <Pressable
            onPress={onDelete}
            disabled={saving || deleting}
            style={({ pressed }) => [
              styles.deleteBtn,
              (pressed || saving || deleting) && styles.btnPressed,
            ]}
          >
            {deleting ? (
              <ActivityIndicator color={colors.redPrimary} />
            ) : (
              <Text style={styles.deleteBtnText}>このマイ食品を削除</Text>
            )}
          </Pressable>
        ) : null}
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
  imageBox: {
    alignItems: 'center',
    marginBottom: 16,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#f0eef7',
  },
  imageHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 6,
  },
  ocrOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 200,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ocrOverlayText: {
    color: colors.white,
    fontSize: fontSize.small,
    marginTop: 8,
  },
  imageActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  imageActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f0eef7',
  },
  imageActionText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  ocrEntry: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ecebf3',
    backgroundColor: '#fafafe',
  },
  ocrEntryHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    lineHeight: 18,
    marginBottom: 10,
  },
  ocrButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ocrBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.darkPurple,
    marginRight: 6,
  },
  ocrBtnSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    marginRight: 0,
    marginLeft: 6,
  },
  ocrBtnIcon: { marginRight: 6 },
  ocrBtnText: {
    color: colors.white,
    fontSize: fontSize.small,
    fontWeight: '600',
  },
  ocrBtnTextSecondary: {
    color: colors.darkPurple,
  },
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
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unitHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    lineHeight: 18,
    marginTop: 6,
  },
  flex1: { flex: 1 },
  unitAiBtn: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderRadius: 8,
    backgroundColor: colors.darkPurple,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitAiBtnText: {
    color: colors.white,
    fontSize: fontSize.small,
    fontWeight: '600',
    marginLeft: 4,
  },
  unitAiBusyInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  pfcRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  pfcCell: {
    flex: 1,
    marginRight: 8,
  },
  metaLine: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 8,
    marginBottom: 8,
  },
  saveBtn: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  deleteBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.redPrimary,
    backgroundColor: colors.white,
  },
  deleteBtnText: {
    color: colors.redPrimary,
    fontSize: fontSize.middle,
    fontWeight: '600',
  },
  btnPressed: { opacity: 0.7 },
})
