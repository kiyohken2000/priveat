import React, { useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../../theme'
import FoodNameInput from '../../components/FoodNameInput'

// 栄養ラベル OCR 経由の食事記録カード。
//
// message.labelRecord:
//   {
//     productId,       // products.id (insertProductFromLabel が返した id)
//     perUnit: { kcal, protein, fat, carb, salt },  // ラベル 1 単位ぶんの栄養素
//     savedFoodLogId,  // 保存後にセット (再編集はさせない)
//     savedSummary,    // 保存後の表示用文字列 (例: "ヨーグルト 2個 · 180 kcal")
//   }
//
// 親 (Chat.js) は onSave(messageId, { name, quantity, unit }) で food_log 挿入を行い、
// 完了したら updateLabelRecord(messageId, { savedFoodLogId, savedSummary }) でカードを更新する。

const round = (n) => (n == null ? null : Math.round(n))

const formatPerUnit = (perUnit) => {
  if (!perUnit) return ''
  const parts = []
  if (perUnit.kcal != null) parts.push(`${round(perUnit.kcal)} kcal`)
  if (perUnit.protein != null) parts.push(`P ${perUnit.protein}g`)
  if (perUnit.fat != null) parts.push(`F ${perUnit.fat}g`)
  if (perUnit.carb != null) parts.push(`C ${perUnit.carb}g`)
  return parts.join(' · ')
}

export default function LabelRecordCard({ message, onSave }) {
  const lr = message.labelRecord ?? {}
  const { perUnit, savedFoodLogId, savedSummary } = lr

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('個')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.floor(screenWidth * 0.85)

  const isSaved = !!savedFoodLogId

  const trimmedName = name.trim()
  const qNum = Number(quantity)
  const qValid = !Number.isNaN(qNum) && qNum > 0
  const canSave = !busy && trimmedName.length > 0 && qValid

  const totalKcal =
    perUnit?.kcal != null && qValid ? Math.round(perUnit.kcal * qNum) : null

  const onPressSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      // 親が必要とする情報を全部渡し、親側で localMessages のスナップショット読みを避ける
      await onSave?.(message._id, {
        name: trimmedName,
        quantity: qNum,
        unit: unit.trim() || '個',
        productId: lr.productId,
        perUnit,
      })
    } catch (e) {
      console.warn('[labelRecordCard] save failed:', e)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <View style={styles.headerRow}>
        <FontIcon name="tag" size={14} color={colors.lightPurple} />
        <Text style={styles.title}>栄養ラベルを記録</Text>
      </View>

      <Text style={styles.subText}>ラベル 1 単位ぶん: {formatPerUnit(perUnit)}</Text>

      {isSaved ? (
        <View style={styles.savedBox}>
          <FontIcon name="check-circle" size={16} color="#3a8a3a" />
          <Text style={styles.savedText}>{savedSummary ?? '記録しました'}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.label}>食品名</Text>
          <FoodNameInput
            value={name}
            onChangeText={setName}
            onCommit={(picked) => setName(picked)}
            placeholder="例: プレーンヨーグルト 200g"
            placeholderTextColor={colors.gray}
            style={styles.input}
            underlineColorAndroid="transparent"
            editable={!busy}
          />

          <View style={styles.row}>
            <View style={styles.colHalf}>
              <Text style={styles.label}>個数</Text>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
                style={[styles.input, !qValid && styles.inputError]}
                underlineColorAndroid="transparent"
                editable={!busy}
              />
            </View>
            <View style={styles.colHalf}>
              <Text style={styles.label}>単位</Text>
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="個 / 本 / 袋..."
                placeholderTextColor={colors.gray}
                style={styles.input}
                underlineColorAndroid="transparent"
                editable={!busy}
              />
            </View>
          </View>

          {totalKcal != null && (
            <Text style={styles.total}>
              合計 {totalKcal} kcal ({qNum}{unit.trim() || '個'})
            </Text>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            onPress={onPressSave}
            disabled={!canSave}
            activeOpacity={0.7}
            style={[styles.button, !canSave && styles.buttonDisabled]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <FontIcon name="plus" size={12} color={colors.white} />
                <Text style={styles.buttonText}>食事として記録</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    marginHorizontal: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.lightGrayPurple,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grayFifth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  title: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  subText: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 10,
  },
  label: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: fontSize.middle,
    color: colors.black,
    borderWidth: 1,
    borderColor: colors.grayFifth,
  },
  inputError: { borderColor: colors.redPrimary },
  row: { flexDirection: 'row', gap: 10 },
  colHalf: { flex: 1 },
  total: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
    marginTop: 10,
    textAlign: 'right',
  },
  button: {
    marginTop: 10,
    backgroundColor: colors.lightPurple,
    borderRadius: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  errorText: {
    fontSize: fontSize.small,
    color: colors.redPrimary,
    marginTop: 8,
  },
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  savedText: {
    fontSize: fontSize.middle,
    color: '#2e7d32',
    fontWeight: '600',
    flex: 1,
  },
})
