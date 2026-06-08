import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import { getLastHealthSync, setLastHealthSync, syncHealthToDb } from '../../health/sync'

const formatDateTime = (iso) => {
  if (!iso) return null
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${day} ${hh}:${mm}`
  } catch (e) {
    return null
  }
}

export default function HealthScreen() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [lastSync, setLastSync] = useState(null)

  useEffect(() => {
    getLastHealthSync().then((v) => {
      if (v) setLastSync(v)
    })
  }, [])

  const onSync = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await syncHealthToDb({ daysBack: 30 })
      setResult(r)
      const now = new Date().toISOString()
      setLastSync(now)
      await setLastHealthSync(now)
    } catch (err) {
      console.warn('[health] sync error:', err)
      Alert.alert('同期エラー', err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.root}>
      <Text style={styles.desc}>
        {Platform.OS === 'ios'
          ? 'ヘルスケア (HealthKit) から体重・消費カロリー・歩数を取得し、Priveat の記録に同期します。'
          : 'Health Connect から体重・消費カロリー・歩数を取得し、Priveat の記録に同期します。'}
        {'\n\n'}過去30日分を取り込み、同じ日付の既存データは上書きします。
      </Text>

      <Pressable
        onPress={onSync}
        disabled={busy}
        style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonPressed]}
      >
        {busy ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>
            {lastSync ? '今すぐ同期する' : 'ヘルス連携を許可して同期する'}
          </Text>
        )}
      </Pressable>

      {lastSync && (
        <Text style={styles.lastSyncText}>最終同期: {formatDateTime(lastSync)}</Text>
      )}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>同期結果</Text>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>体重</Text>
            <Text style={styles.resultValue}>
              新規 {result.weight.inserted} 日 / 更新 {result.weight.updated} 日
            </Text>
          </View>

          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>消費カロリー + 歩数</Text>
            <Text style={styles.resultValue}>
              新規 {result.energy.inserted} 日 / 更新 {result.energy.updated} 日
            </Text>
          </View>

          <View style={styles.resultDivider} />

          <Text style={styles.resultMeta}>
            HealthKit から取得: 体重 {result.fetched.weights} 件 ・ 消費カロリー{' '}
            {result.fetched.activeEnergy} 件 ・ 歩数 {result.fetched.steps} 件
          </Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: { padding: 20, paddingBottom: 40 },
  desc: {
    fontSize: fontSize.middle,
    color: colors.gray,
    marginBottom: 18,
    lineHeight: 20,
  },
  button: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  lastSyncText: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 10,
    textAlign: 'center',
  },
  resultBox: {
    marginTop: 18,
    padding: 14,
    backgroundColor: '#f4f3fb',
    borderRadius: 10,
  },
  resultTitle: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    marginBottom: 10,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  resultLabel: { fontSize: fontSize.middle, color: colors.darkPurple },
  resultValue: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  resultDivider: {
    height: 1,
    backgroundColor: '#e5e2f0',
    marginVertical: 8,
  },
  resultMeta: { fontSize: fontSize.small, color: colors.gray, lineHeight: 18 },
})
