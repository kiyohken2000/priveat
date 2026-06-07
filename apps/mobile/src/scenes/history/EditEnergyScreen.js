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
import { getEnergyLogItem, updateEnergyLogItem } from '../../db/energyLog'

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

export default function EditEnergyScreen() {
  const route = useRoute()
  const navigation = useNavigation()
  const { id } = route.params

  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState(null)
  const [activityName, setActivityName] = useState('')
  const [durationMin, setDurationMin] = useState('')
  const [activeKcal, setActiveKcal] = useState('')
  const [steps, setSteps] = useState('')
  const [loggedAt, setLoggedAt] = useState(new Date())
  const [pickerVisible, setPickerVisible] = useState(false)

  const load = useCallback(async () => {
    try {
      const row = await getEnergyLogItem(id)
      if (!row) {
        Alert.alert('エラー', '対象の運動ログが見つかりません。')
        navigation.goBack()
        return
      }
      setSource(row.source ?? null)
      setActivityName(row.activity_name ?? '')
      setDurationMin(row.duration_min != null ? String(row.duration_min) : '')
      setActiveKcal(row.active_kcal != null ? String(row.active_kcal) : '')
      setSteps(row.steps != null ? String(row.steps) : '')
      setLoggedAt(new Date(row.logged_at))
    } catch (err) {
      console.warn('[editEnergy] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [id, navigation])

  useEffect(() => {
    load()
  }, [load])

  const onSave = async () => {
    if (busy) return
    setBusy(true)
    try {
      await updateEnergyLogItem(id, {
        logged_at: loggedAt.toISOString(),
        activity_name: activityName.trim() || null,
        duration_min: toNum(durationMin),
        active_kcal: toNum(activeKcal),
        steps: toNum(steps),
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

        <Field label="種目">
          <TextInput
            value={activityName}
            onChangeText={setActivityName}
            placeholder="例: ランニング"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <View style={styles.row}>
          <View style={styles.flex1}>
            <Field label="時間 (分)">
              <TextInput
                value={durationMin}
                onChangeText={setDurationMin}
                keyboardType="decimal-pad"
                placeholder="例: 30"
                placeholderTextColor={colors.gray}
                style={styles.input}
              />
            </Field>
          </View>
          <View style={[styles.flex1, { marginLeft: 12 }]}>
            <Field label="消費 (kcal)">
              <TextInput
                value={activeKcal}
                onChangeText={setActiveKcal}
                keyboardType="number-pad"
                placeholder="例: 250"
                placeholderTextColor={colors.gray}
                style={styles.input}
              />
            </Field>
          </View>
        </View>

        <Field label="歩数 (任意)">
          <TextInput
            value={steps}
            onChangeText={setSteps}
            keyboardType="number-pad"
            placeholder="例: 10000"
            placeholderTextColor={colors.gray}
            style={styles.input}
          />
        </Field>

        <Field label="日時">
          <Pressable
            onPress={() => setPickerVisible(true)}
            style={({ pressed }) => [styles.input, styles.dateButton, pressed && styles.btnPressed]}
          >
            <Text style={styles.dateText}>{formatDateTime(loggedAt.toISOString())}</Text>
          </Pressable>
        </Field>

        <DateTimePickerModal
          isVisible={pickerVisible}
          mode="datetime"
          date={loggedAt}
          onConfirm={(d) => {
            setLoggedAt(d)
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
