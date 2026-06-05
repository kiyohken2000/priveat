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

// テキスト経由の活動量記録カード。
//
// message.activityRecord:
//   {
//     initial_name,         // 種目名 (canonical 化済み)
//     initial_duration_min, // 時間。距離→換算後の値が入っている場合もある
//     initial_distance_km,  // 距離 (表示用、保存はしない)
//     initial_kcal,         // 推定 kcal (体重 × MET × 時間 × 1.05)
//     met,                  // MET 値 (duration 編集時の再計算に使う)
//     weight_kg_used,       // kcal 計算に使った体重 (profile/weight_log の最新 or 60kg)
//     savedEnergyLogId,     // 保存後にセット
//     savedSummary,
//   }
//
// 親 (Chat.js) は onSave(messageId, { activity_name, duration_min, active_kcal }) で
// energy_log INSERT を行い、結果を activityRecord にマージして再描画する。

const recomputeKcal = (durMin, met, weightKg) => {
  if (!met || !weightKg || !(durMin > 0)) return null
  return Math.round(met * weightKg * (durMin / 60) * 1.05)
}

export default function ActivityCard({ message, onSave }) {
  const ar = message.activityRecord ?? {}
  const {
    initial_name,
    initial_duration_min,
    initial_distance_km,
    initial_kcal,
    met,
    weight_kg_used,
    savedEnergyLogId,
    savedSummary,
  } = ar

  const [name, setName] = useState(initial_name ?? '')
  const [durationStr, setDurationStr] = useState(
    initial_duration_min != null ? String(Math.round(initial_duration_min)) : '',
  )
  const [kcalStr, setKcalStr] = useState(
    initial_kcal != null ? String(initial_kcal) : '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.floor(screenWidth * 0.85)

  const isSaved = !!savedEnergyLogId

  const durNum = Number(durationStr)
  const kcalNum = Number(kcalStr)
  const durValid = !Number.isNaN(durNum) && durNum > 0 && durNum <= 1440
  const kcalValid = !Number.isNaN(kcalNum) && kcalNum > 0 && kcalNum <= 10000
  const canSave = !busy && name.trim().length > 0 && durValid && kcalValid

  // 時間が変わったら kcal を自動再計算。kcal 側を編集した場合は触らない。
  const onChangeDuration = (txt) => {
    setDurationStr(txt)
    const n = Number(txt)
    const recomputed = recomputeKcal(n, met, weight_kg_used)
    if (recomputed != null) setKcalStr(String(recomputed))
  }

  const onPressSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      await onSave?.(message._id, {
        activity_name: name.trim(),
        duration_min: durNum,
        active_kcal: kcalNum,
      })
    } catch (e) {
      console.warn('[activityCard] save failed:', e)
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <View style={styles.headerRow}>
        <FontIcon name="bicycle" size={14} color={colors.lightPurple} />
        <Text style={styles.title}>運動を記録</Text>
      </View>

      {initial_distance_km != null && (
        <Text style={styles.subText}>
          入力: {initial_distance_km} km
          {initial_duration_min != null
            ? ` → 約 ${Math.round(initial_duration_min)} 分に換算`
            : ''}
        </Text>
      )}

      {isSaved ? (
        <View style={styles.savedBox}>
          <FontIcon name="check-circle" size={16} color="#3a8a3a" />
          <Text style={styles.savedText}>{savedSummary ?? '記録しました'}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.label}>種目</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例: ランニング"
            placeholderTextColor={colors.gray}
            style={styles.input}
            underlineColorAndroid="transparent"
            editable={!busy}
          />

          <View style={styles.row}>
            <View style={styles.colHalf}>
              <Text style={styles.label}>時間 (分)</Text>
              <TextInput
                value={durationStr}
                onChangeText={onChangeDuration}
                keyboardType="numeric"
                placeholder="30"
                placeholderTextColor={colors.gray}
                style={[
                  styles.input,
                  !durValid && durationStr.length > 0 && styles.inputError,
                ]}
                underlineColorAndroid="transparent"
                editable={!busy}
              />
            </View>
            <View style={styles.colHalf}>
              <Text style={styles.label}>消費カロリー</Text>
              <View style={styles.kcalRow}>
                <TextInput
                  value={kcalStr}
                  onChangeText={setKcalStr}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.gray}
                  style={[
                    styles.input,
                    styles.kcalInput,
                    !kcalValid && kcalStr.length > 0 && styles.inputError,
                  ]}
                  underlineColorAndroid="transparent"
                  editable={!busy}
                />
                <Text style={styles.unit}>kcal</Text>
              </View>
            </View>
          </View>

          {weight_kg_used != null && met != null && (
            <Text style={styles.metaText}>
              体重 {weight_kg_used} kg / MET {met} 換算
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
    marginBottom: 6,
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
  metaText: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 8,
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
