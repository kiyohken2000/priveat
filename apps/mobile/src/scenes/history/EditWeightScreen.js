import { useNavigation, useRoute } from '@react-navigation/native'
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
import DateTimePickerModal from 'react-native-modal-datetime-picker'
import { colors, fontSize } from '../../theme'
import { getWeightLogItem, updateWeightLogItem } from '../../db/weightLog'

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

export default function EditWeightScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const { id } = route.params

  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState(null)
  const [weightKg, setWeightKg] = useState('')
  const [measuredAt, setMeasuredAt] = useState(new Date())
  const [pickerVisible, setPickerVisible] = useState(false)

  const load = useCallback(async () => {
    try {
      const row = await getWeightLogItem(id)
      if (!row) {
        Alert.alert('エラー', '対象の体重ログが見つかりません。')
        navigation.goBack()
        return
      }
      setSource(row.source ?? null)
      setWeightKg(row.weight_kg != null ? String(row.weight_kg) : '')
      setMeasuredAt(new Date(row.measured_at))
    } catch (err) {
      console.warn('[editWeight] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [id, navigation])

  useEffect(() => {
    load()
  }, [load])

  const onSave = async () => {
    if (busy) return
    const w = toNum(weightKg)
    if (w == null || w <= 0) {
      Alert.alert('入力エラー', '体重は正の数値で入力してください。')
      return
    }
    setBusy(true)
    try {
      await updateWeightLogItem(id, {
        measured_at: measuredAt.toISOString(),
        weight_kg: w,
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
        {source && source !== 'text' && source !== 'manual' && (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              source = {source} の行を編集しています。同期や OCR で生成された値は、
              次回同期や再 OCR で上書きされる可能性があります。
            </Text>
          </View>
        )}

        <Field label="体重 (kg)">
          <TextInput
            value={weightKg}
            onChangeText={setWeightKg}
            keyboardType="decimal-pad"
            placeholder="例: 65.2"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <Field label="日時">
          <Pressable
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [styles.input, styles.dateButton, pressed && styles.btnPressed]}
          >
            <Text style={styles.dateText}>{formatDateTime(measuredAt.toISOString())}</Text>
          </Pressable>
        </Field>

        <DateTimePickerModal
          isVisible={pickerVisible}
          mode="datetime"
          date={measuredAt}
          onConfirm={(d) => {
            setMeasuredAt(d)
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

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
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
  warnBox: {
    backgroundColor: '#fff3e0',
    borderColor: '#ffb74d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  warnText: { fontSize: fontSize.small, color: '#e65100', lineHeight: 18 },
})
