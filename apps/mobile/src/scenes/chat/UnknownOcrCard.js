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

// OCR の振り分けに失敗した (kind='unknown') ときの手入力カード。
//
// message.unknownOcr:
//   {
//     rawText,          // OCR が読み取った生テキスト (参考表示用)
//     savedFoodLogId,   // 保存後にセット
//     savedSummary,     // 保存後の表示用文字列
//   }
//
// 親 (Chat.js) は onSave(messageId, { name, quantity, unit, kcal }) で食事保存を行う。
// kcal が null/未入力なら DB 検索で自動補完、入力されていればその値をそのまま使う。

const TEXT_PREVIEW_LEN = 200

export default function UnknownOcrCard({ message, onSave }) {
  const card = message.unknownOcr ?? {}
  const { rawText = '', savedFoodLogId, savedSummary } = card

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState('人前')
  const [kcalStr, setKcalStr] = useState('')
  const [showFull, setShowFull] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.floor(screenWidth * 0.85)

  const isSaved = !!savedFoodLogId
  const trimmedName = name.trim()
  const qNum = Number(quantity)
  const qValid = !Number.isNaN(qNum) && qNum > 0
  const kcalNum = kcalStr.trim() ? Number(kcalStr) : null
  // kcal は空 OK (DB 検索でフォールバック)。入力時のみ妥当性をチェック。
  const kcalValid =
    kcalNum == null || (!Number.isNaN(kcalNum) && kcalNum >= 0 && kcalNum <= 10000)
  const canSave = !busy && trimmedName.length > 0 && qValid && kcalValid

  const showableText = rawText.trim()
  const isLong = showableText.length > TEXT_PREVIEW_LEN
  const visibleText =
    showFull || !isLong
      ? showableText
      : `${showableText.slice(0, TEXT_PREVIEW_LEN)}…`

  const onPressSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await onSave?.(message._id, {
        name: trimmedName,
        quantity: qNum,
        unit: unit.trim() || '人前',
        kcal: kcalNum, // null なら親側で DB 検索する
      })
    } catch (e) {
      console.warn('[unknownOcrCard] save failed:', e)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <View style={styles.headerRow}>
        <FontIcon name="question-circle-o" size={14} color={colors.lightPurple} />
        <Text style={styles.title}>判定できない画像を記録</Text>
      </View>

      {showableText.length > 0 ? (
        <View style={styles.ocrBlock}>
          <Text style={styles.ocrLabel}>読取テキスト</Text>
          <Text style={styles.ocrText} selectable>
            {visibleText}
          </Text>
          {isLong && (
            <TouchableOpacity
              onPress={() => setShowFull((v) => !v)}
              activeOpacity={0.6}
            >
              <Text style={styles.toggle}>
                {showFull ? '一部だけ表示' : '全文を表示'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <Text style={styles.ocrEmpty}>文字を検出できませんでした</Text>
      )}

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
            placeholder="例: ハンバーガー"
            placeholderTextColor={colors.gray}
            style={styles.input}
            underlineColorAndroid="transparent"
            editable={!busy}
          />

          <View style={styles.row}>
            <View style={styles.colHalf}>
              <Text style={styles.label}>数量</Text>
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
                placeholder="個 / 杯 / 人前..."
                placeholderTextColor={colors.gray}
                style={styles.input}
                underlineColorAndroid="transparent"
                editable={!busy}
              />
            </View>
          </View>

          <Text style={styles.label}>カロリー (任意)</Text>
          <View style={styles.kcalRow}>
            <TextInput
              value={kcalStr}
              onChangeText={setKcalStr}
              keyboardType="numeric"
              placeholder="空欄なら食品DBから推定"
              placeholderTextColor={colors.gray}
              style={[
                styles.input,
                styles.kcalInput,
                !kcalValid && styles.inputError,
              ]}
              underlineColorAndroid="transparent"
              editable={!busy}
            />
            <Text style={styles.unit}>kcal</Text>
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
    marginBottom: 8,
  },
  title: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  ocrBlock: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grayFifth,
  },
  ocrLabel: {
    fontSize: fontSize.small,
    color: colors.gray,
    fontWeight: '600',
    marginBottom: 4,
  },
  ocrText: {
    fontSize: fontSize.small,
    color: colors.black,
    lineHeight: 18,
  },
  toggle: {
    marginTop: 6,
    fontSize: fontSize.small,
    color: colors.lightPurple,
    fontWeight: '600',
  },
  ocrEmpty: {
    fontSize: fontSize.small,
    color: colors.gray,
    fontStyle: 'italic',
    marginBottom: 8,
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
  kcalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kcalInput: { flex: 1 },
  unit: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
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
