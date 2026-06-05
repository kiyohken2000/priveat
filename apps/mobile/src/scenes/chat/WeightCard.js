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

// テキスト経由の体重記録カード。
//
// message.weightRecord:
//   {
//     initial_kg,       // LLM が抽出した初期値
//     savedWeightLogId, // 保存後にセット (再編集はさせない)
//     savedSummary,     // 保存後の表示用文字列 (例: "68.5 kg を記録しました")
//   }
//
// 親 (Chat.js) は onSave(messageId, { weight_kg }) で weight_log INSERT を行い、
// 完了したら weightRecord に savedWeightLogId / savedSummary をセットして再描画する。

export default function WeightCard({ message, onSave }) {
  const wr = message.weightRecord ?? {}
  const { initial_kg, savedWeightLogId, savedSummary } = wr

  const [value, setValue] = useState(
    initial_kg != null ? String(initial_kg) : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.floor(screenWidth * 0.85)

  const isSaved = !!savedWeightLogId

  const num = Number(value)
  const valid = !Number.isNaN(num) && num > 0 && num <= 500
  const canSave = !busy && valid

  const onPressSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await onSave?.(message._id, { weight_kg: num })
    } catch (e) {
      console.warn('[weightCard] save failed:', e)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <View style={styles.headerRow}>
        <FontIcon name="balance-scale" size={14} color={colors.lightPurple} />
        <Text style={styles.title}>体重を記録</Text>
      </View>

      {isSaved ? (
        <View style={styles.savedBox}>
          <FontIcon name="check-circle" size={16} color="#3a8a3a" />
          <Text style={styles.savedText}>{savedSummary ?? '記録しました'}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.label}>体重 (kg)</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholder="例: 68.5"
              placeholderTextColor={colors.gray}
              style={[styles.input, !valid && value.length > 0 && styles.inputError]}
              underlineColorAndroid="transparent"
              editable={!busy}
            />
            <Text style={styles.unit}>kg</Text>
          </View>

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
                <Text style={styles.buttonText}>記録する</Text>
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
    marginBottom: 6,
  },
  title: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  label: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
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
  unit: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  button: {
    marginTop: 12,
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
