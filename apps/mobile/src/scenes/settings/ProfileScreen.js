import React, { useCallback, useEffect, useState } from 'react'
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
import { colors, fontSize } from '../../theme'
import { getLatestWeight, getProfile, saveProfile } from '../../db/profile'

const toNum = (v) => {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  const n = parseFloat(s)
  return Number.isNaN(n) ? null : n
}

const toInt = (v) => {
  const n = toNum(v)
  return n == null ? null : Math.round(n)
}

const formatDate = (iso) => {
  if (!iso) return null
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
  } catch (e) {
    return null
  }
}

export default function ProfileScreen() {
  const [age, setAge] = useState('')
  const [sex, setSex] = useState(null)
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [targetWeight, setTargetWeight] = useState('')
  const [kcalTarget, setKcalTarget] = useState('')
  const [lastWeightDate, setLastWeightDate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([getProfile(), getLatestWeight()])
      if (p) {
        setAge(p.age != null ? String(p.age) : '')
        setSex(p.sex ?? null)
        setHeight(p.height_cm != null ? String(p.height_cm) : '')
        setTargetWeight(p.target_weight_kg != null ? String(p.target_weight_kg) : '')
        setKcalTarget(p.daily_kcal_target != null ? String(p.daily_kcal_target) : '')
      }
      if (w) {
        setWeight(String(w.weight_kg))
        setLastWeightDate(formatDate(w.measured_at))
      }
    } catch (err) {
      console.warn('[profile] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onSave = async () => {
    if (busy) return
    const data = {
      age: toInt(age),
      sex,
      heightCm: toNum(height),
      targetWeightKg: toNum(targetWeight),
      dailyKcalTarget: toNum(kcalTarget),
      newWeightKg: toNum(weight),
    }

    if (data.age != null && (data.age < 1 || data.age > 120)) {
      Alert.alert('入力エラー', '年齢は 1〜120 の範囲で入力してください。')
      return
    }
    if (data.heightCm != null && (data.heightCm < 50 || data.heightCm > 250)) {
      Alert.alert('入力エラー', '身長は 50〜250 cm の範囲で入力してください。')
      return
    }
    if (data.newWeightKg != null && (data.newWeightKg < 20 || data.newWeightKg > 300)) {
      Alert.alert('入力エラー', '体重は 20〜300 kg の範囲で入力してください。')
      return
    }

    setBusy(true)
    try {
      const res = await saveProfile(data)
      if (res.appendedWeightId != null) {
        setLastWeightDate(formatDate(new Date().toISOString()))
      }
      Alert.alert('保存しました', 'プロフィールを更新しました。')
    } catch (err) {
      console.warn('[profile] save error:', err)
      Alert.alert('保存エラー', err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
        <Text style={styles.desc}>消費カロリー（基礎代謝）の計算に使用します。</Text>

        <Field label="年齢">
          <TextInput
            value={age}
            onChangeText={setAge}
            keyboardType="number-pad"
            placeholder="例: 35"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
          <Text style={styles.unit}>歳</Text>
        </Field>

        <Field label="性別">
          <View style={styles.segment}>
            <SegmentButton label="男性" active={sex === 'male'} onPress={() => setSex('male')} />
            <SegmentButton label="女性" active={sex === 'female'} onPress={() => setSex('female')} />
            <SegmentButton label="未設定" active={sex == null} onPress={() => setSex(null)} />
          </View>
        </Field>

        <Field label="身長">
          <TextInput
            value={height}
            onChangeText={setHeight}
            keyboardType="decimal-pad"
            placeholder="例: 170"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
          <Text style={styles.unit}>cm</Text>
        </Field>

        <Field label="現在の体重">
          <TextInput
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            placeholder="例: 65.5"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
          <Text style={styles.unit}>kg</Text>
        </Field>
        {lastWeightDate && <Text style={styles.subText}>最後に記録: {lastWeightDate}</Text>}

        <Field label="目標体重">
          <TextInput
            value={targetWeight}
            onChangeText={setTargetWeight}
            keyboardType="decimal-pad"
            placeholder="任意"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
          <Text style={styles.unit}>kg</Text>
        </Field>

        <Field label="1日のカロリー目標">
          <TextInput
            value={kcalTarget}
            onChangeText={setKcalTarget}
            keyboardType="number-pad"
            placeholder="任意"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
          <Text style={styles.unit}>kcal</Text>
        </Field>

        <Pressable
          onPress={onSave}
          disabled={busy || !loaded}
          style={({ pressed }) => [
            styles.button,
            (pressed || busy || !loaded) && styles.buttonPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>保存</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const Field = ({ label, children }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.fieldRow}>{children}</View>
  </View>
)

const SegmentButton = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [
      styles.segmentBtn,
      active && styles.segmentBtnActive,
      pressed && styles.segmentBtnPressed,
    ]}
  >
    <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{label}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: {
    padding: 20,
    paddingBottom: 60,
  },
  desc: {
    fontSize: fontSize.middle,
    color: colors.gray,
    marginBottom: 18,
    lineHeight: 20,
  },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: fontSize.small, color: colors.gray, marginBottom: 4 },
  fieldRow: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    backgroundColor: '#fafafe',
  },
  unit: { marginLeft: 8, color: colors.gray, fontSize: fontSize.middle },
  subText: { fontSize: fontSize.small, color: colors.gray, marginTop: -8, marginBottom: 8 },
  segment: {
    flex: 1,
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
    justifyContent: 'center',
    backgroundColor: '#fafafe',
  },
  segmentBtnActive: { backgroundColor: colors.lightPurple },
  segmentBtnPressed: { opacity: 0.7 },
  segmentBtnText: { fontSize: fontSize.middle, color: colors.darkPurple },
  segmentBtnTextActive: { color: colors.white, fontWeight: '600' },
  button: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
})
