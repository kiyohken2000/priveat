import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../theme'
import { syncHealthToDb } from '../health/sync'

// ヘルスケア / Health Connect への 1 タップ同期ボタン。
// 設定画面の HealthScreen と同じ syncHealthToDb / 同じ LAST_SYNC_KEY を共有。
// 完了後に親側で再読込が必要なら onComplete を渡す。

const LAST_SYNC_KEY = '@priveat/health-last-sync'

const formatRelative = (iso) => {
  if (!iso) return null
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const min = Math.floor(diffMs / 60000)
    if (min < 1) return 'たった今'
    if (min < 60) return `${min} 分前`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h} 時間前`
    const d = Math.floor(h / 24)
    return `${d} 日前`
  } catch (e) {
    return null
  }
}

export default function SyncHealthButton({ onComplete, compact = false }) {
  const [busy, setBusy] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  useEffect(() => {
    AsyncStorage.getItem(LAST_SYNC_KEY).then((v) => {
      if (v) setLastSync(v)
    })
  }, [])

  const onPress = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await syncHealthToDb({ daysBack: 30 })
      const now = new Date().toISOString()
      setLastSync(now)
      await AsyncStorage.setItem(LAST_SYNC_KEY, now)
      onComplete?.()
      const w = r?.weight?.inserted + r?.weight?.updated || 0
      const e = r?.energy?.inserted + r?.energy?.updated || 0
      if (w === 0 && e === 0) {
        Alert.alert('同期完了', '新しいデータはありませんでした。')
      }
    } catch (err) {
      console.warn('[syncHealthButton] failed:', err)
      Alert.alert('同期エラー', err?.message ?? String(err))
    } finally {
      setBusy(false)
    }
  }, [busy, onComplete])

  const rel = formatRelative(lastSync)

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        busy && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.lightPurple} />
      ) : (
        <FontIcon name="heart" size={14} color={colors.lightPurple} />
      )}
      <View style={styles.labelWrap}>
        <Text style={styles.label}>
          {busy ? '同期中...' : 'ヘルスケアと同期'}
        </Text>
        {rel && !busy && <Text style={styles.sub}>最終: {rel}</Text>}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#f4f3fb',
    borderWidth: 1,
    borderColor: '#e5e2f0',
    marginBottom: 12,
  },
  buttonCompact: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.7 },
  labelWrap: { flex: 1 },
  label: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  sub: {
    fontSize: 10,
    color: colors.gray,
    marginTop: 2,
  },
})
