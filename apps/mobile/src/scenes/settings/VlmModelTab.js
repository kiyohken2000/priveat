import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import { useActiveModel } from '../../state/modelContext'
import { VLM_MODELS, totalVlmModelSizeBytes } from '../../data/llmModelsVlm'
import {
  cancelVlmModelDownload,
  deleteVlmModel,
  downloadVlmModel,
  listDownloadedVlmModelIds,
} from '../../services/vlmModelStorage'
import { canRunOnDevice, getDeviceRamBytes } from '../../utils/deviceRam'

// VLM (llama.rn 経由) 専用タブ。
//   - executorch とは独立した llama.rn が裏で立ち上がる経路なので、
//     ModelScreen 本体の executorch ベースの DL/削除/状態管理とは分離してある。
//   - 表示するモデルは data/llmModelsVlm.js の VLM_MODELS (Qwen3-VL-2B / SmolVLM-500M)。
//   - ON/OFF トグルが OFF のときは DL ボタンを抑止し、有効化を促すヒントを出す。
//     Chat 側 (handlePhotoForVision) は vlmEnabled を見て写真認識ボタンの挙動を分岐。

const formatBytes = (bytes) => {
  if (bytes == null) return '?'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1000) return `${(mb / 1000).toFixed(2)} GB`
  return `${Math.round(mb)} MB`
}

export default function VlmModelTab() {
  const { vlmEnabled, vlmModelId, setVlmEnabled, setVlmModelId } = useActiveModel()

  const ramBytes = useMemo(() => getDeviceRamBytes(), [])

  const [downloadedIds, setDownloadedIds] = useState(new Set())
  const [progressMap, setProgressMap] = useState({}) // { modelId: 0..1 }
  const [statusLoading, setStatusLoading] = useState(true)

  const refreshStatus = useCallback(async () => {
    try {
      setStatusLoading(true)
      const ids = await listDownloadedVlmModelIds(VLM_MODELS)
      setDownloadedIds(new Set(ids))
    } catch (e) {
      console.warn('[vlmTab] refresh error:', e)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshStatus()
    }, [refreshStatus]),
  )

  const onToggleEnabled = async (next) => {
    await setVlmEnabled(next)
  }

  const onDownload = async (model) => {
    if (progressMap[model.id] != null) return
    if (!vlmEnabled) {
      Alert.alert('写真認識が無効です', '上のスイッチを ON にしてからダウンロードしてください。')
      return
    }
    setProgressMap((p) => ({ ...p, [model.id]: 0 }))
    try {
      await downloadVlmModel(model, (p) => {
        setProgressMap((prev) => ({ ...prev, [model.id]: p }))
      })
      await refreshStatus()
    } catch (err) {
      console.warn('[vlmTab] download error:', err)
      Alert.alert('ダウンロードエラー', err?.message ?? String(err))
    } finally {
      setProgressMap((prev) => {
        const next = { ...prev }
        delete next[model.id]
        return next
      })
    }
  }

  const onCancel = async (model) => {
    await cancelVlmModelDownload(model)
    setProgressMap((prev) => {
      const next = { ...prev }
      delete next[model.id]
      return next
    })
  }

  const onUse = (model) => {
    if (model.id === vlmModelId) return
    setVlmModelId(model.id)
  }

  const onDelete = (model) => {
    if (model.id === vlmModelId && vlmEnabled) {
      Alert.alert(
        '削除できません',
        'このモデルは現在「写真認識」に設定されています。先に別のモデルに切り替えるか、写真認識を OFF にしてから削除してください。',
      )
      return
    }
    Alert.alert(
      'モデルを削除しますか？',
      `${model.label} の本体 + mmproj ファイルを削除します。再度使うにはダウンロードし直しが必要です。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteVlmModel(model)
              await refreshStatus()
            } catch (err) {
              console.warn('[vlmTab] delete error:', err)
              Alert.alert('削除エラー', err?.message ?? String(err))
            }
          },
        },
      ],
    )
  }

  return (
    <View>
      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleTitle}>写真認識を有効にする</Text>
          <Text style={styles.toggleHint}>
            ON にするとチャット画面の📷ボタンに「料理写真として認識」が現れ、選択したモデルで料理名を抽出します。
          </Text>
        </View>
        <Switch
          value={vlmEnabled}
          onValueChange={onToggleEnabled}
          trackColor={{ false: '#dcd9ec', true: colors.lightPurple }}
        />
      </View>

      {!vlmEnabled && (
        <View style={styles.disabledBanner}>
          <Text style={styles.disabledText}>
            ⏸ 写真認識は OFF です。ダウンロードや切り替えはトグル ON のあと有効になります。
          </Text>
        </View>
      )}

      {statusLoading && (
        <View style={styles.statusBox}>
          <ActivityIndicator color={colors.lightPurple} />
          <Text style={styles.statusBoxText}>ダウンロード状況を確認中…</Text>
        </View>
      )}

      {VLM_MODELS.map((m) => {
        const isSelected = m.id === vlmModelId
        const isDownloaded = downloadedIds.has(m.id)
        const progress = progressMap[m.id]
        const isDownloading = progress != null
        const pct = Math.round((progress ?? 0) * 100)
        const totalBytes = totalVlmModelSizeBytes(m)
        const compat = canRunOnDevice(m, ramBytes)
        const unsupported = !compat.ok
        const dimmed = !vlmEnabled

        return (
          <View
            key={m.id}
            style={[
              styles.card,
              isSelected && vlmEnabled && styles.cardActive,
              unsupported && styles.cardUnsupported,
              dimmed && styles.cardDimmed,
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{m.label}</Text>
              <View
                style={[
                  styles.badge,
                  isSelected && vlmEnabled && styles.badgeActive,
                  unsupported && !isSelected && styles.badgeUnsupported,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isSelected && vlmEnabled && styles.badgeTextActive,
                    unsupported && !isSelected && styles.badgeTextUnsupported,
                  ]}
                >
                  {isSelected && vlmEnabled
                    ? '写真認識で使用中'
                    : unsupported
                      ? '非対応'
                      : m.badge}
                </Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{m.description}</Text>
            <Text style={styles.cardMeta}>
              合計サイズ: {formatBytes(totalBytes)} (main + mmproj)
              {isDownloaded ? '  ・  ✓ ダウンロード済み' : ''}
            </Text>

            {unsupported && <Text style={styles.cardWarn}>⚠ {compat.reason}</Text>}

            {isDownloading && (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
                <Text style={styles.progressText}>{pct}%</Text>
              </View>
            )}

            <View style={styles.actions}>
              {isDownloading ? (
                <Pressable
                  onPress={() => onCancel(m)}
                  style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.btnPressed]}
                >
                  <Text style={styles.btnSecondaryText}>キャンセル</Text>
                </Pressable>
              ) : isDownloaded ? (
                <>
                  {!isSelected && (
                    <Pressable
                      onPress={() => onUse(m)}
                      disabled={unsupported || !vlmEnabled}
                      style={({ pressed }) => [
                        styles.btn,
                        styles.btnPrimary,
                        (unsupported || !vlmEnabled) && styles.btnDisabled,
                        pressed && !unsupported && vlmEnabled && styles.btnPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.btnPrimaryText,
                          (unsupported || !vlmEnabled) && styles.btnDisabledText,
                        ]}
                      >
                        写真認識に設定
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => onDelete(m)}
                    style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.btnPressed]}
                  >
                    <Text style={[styles.btnSecondaryText, styles.btnDanger]}>削除</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => onDownload(m)}
                  disabled={unsupported || !vlmEnabled}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnPrimary,
                    (unsupported || !vlmEnabled) && styles.btnDisabled,
                    pressed && !unsupported && vlmEnabled && styles.btnPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.btnPrimaryText,
                      (unsupported || !vlmEnabled) && styles.btnDisabledText,
                    ]}
                  >
                    ダウンロード
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )
      })}

      <Text style={styles.note}>
        ※ VLM は llama.rn (llama.cpp) で動きます。記録/コーチ用 LLM とは別エンジン{'\n'}
        ※ 写真認識中は記録/コーチ用 LLM を一時的に退避し、終了後に自動復帰します{'\n'}
        ※ モデルファイルは端末の Documents ディレクトリに保存されます (アプリ削除で消えます)
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafe',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e2f0',
  },
  toggleTextWrap: { flex: 1, marginRight: 12 },
  toggleTitle: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
    marginBottom: 2,
  },
  toggleHint: { fontSize: fontSize.small, color: colors.gray, lineHeight: 18 },
  disabledBanner: {
    backgroundColor: '#f4f3fb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  disabledText: { fontSize: fontSize.small, color: colors.darkPurple },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f3fb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  statusBoxText: { marginLeft: 8, color: colors.darkPurple, fontSize: fontSize.middle },
  card: {
    backgroundColor: '#fafafe',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e2f0',
  },
  cardActive: { backgroundColor: '#f4f3fb', borderColor: colors.lightPurple, borderWidth: 2 },
  cardUnsupported: { opacity: 0.6 },
  cardDimmed: { opacity: 0.5 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitle: { fontSize: fontSize.large, fontWeight: '700', color: colors.darkPurple, flexShrink: 1 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#e5e2f0',
    marginLeft: 8,
  },
  badgeActive: { backgroundColor: colors.lightPurple },
  badgeText: { fontSize: fontSize.small, color: colors.darkPurple, fontWeight: '600' },
  badgeTextActive: { color: colors.white },
  badgeUnsupported: { backgroundColor: '#f4d4d4' },
  badgeTextUnsupported: { color: '#a33' },
  cardDesc: { fontSize: fontSize.middle, color: colors.darkPurple, marginBottom: 4, lineHeight: 20 },
  cardMeta: { fontSize: fontSize.small, color: colors.gray },
  cardWarn: { fontSize: fontSize.small, color: '#a33', marginTop: 6 },
  progressWrap: { marginTop: 10, flexDirection: 'row', alignItems: 'center' },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#e5e2f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  progressFill: { height: '100%', backgroundColor: colors.lightPurple },
  progressText: { fontSize: fontSize.small, color: colors.darkPurple, minWidth: 40, textAlign: 'right' },
  actions: { flexDirection: 'row', marginTop: 12, gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.lightPurple },
  btnPrimaryText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  btnSecondary: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#dcd9ec' },
  btnSecondaryText: { color: colors.darkPurple, fontSize: fontSize.middle, fontWeight: '600' },
  btnDanger: { color: '#c44' },
  btnDisabled: { opacity: 0.4 },
  btnDisabledText: { color: colors.gray },
  btnPressed: { opacity: 0.7 },
  note: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 8,
    lineHeight: 18,
  },
})
