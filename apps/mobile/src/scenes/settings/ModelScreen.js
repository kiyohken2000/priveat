import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import { LLM_MODELS } from '../../data/llmModels'
import { useActiveModel } from '../../state/modelContext'
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  listDownloadedModelIds,
} from '../../services/modelStorage'

const formatSize = (mb) => {
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`
  return `${mb} MB`
}

export default function ModelScreen() {
  const { activeModelId, setActiveModelId } = useActiveModel()
  // どのモデルが DL 済みか（Set<string>）
  const [downloadedIds, setDownloadedIds] = useState(new Set())
  // モデル ID → 進捗 (0..1)。進捗が入っているモデルは「ダウンロード中」とみなす
  const [progressMap, setProgressMap] = useState({})
  // 状態取得中フラグ
  const [statusLoading, setStatusLoading] = useState(true)

  const refreshStatus = useCallback(async () => {
    try {
      setStatusLoading(true)
      const ids = await listDownloadedModelIds(LLM_MODELS)
      setDownloadedIds(new Set(ids))
    } catch (e) {
      console.warn('[modelScreen] refresh error:', e)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      refreshStatus()
    }, [refreshStatus]),
  )

  const onDownload = async (model) => {
    if (progressMap[model.id] != null) return
    setProgressMap((p) => ({ ...p, [model.id]: 0 }))
    try {
      await downloadModel(model, (p) => {
        setProgressMap((prev) => ({ ...prev, [model.id]: p }))
      })
      await refreshStatus()
    } catch (err) {
      console.warn('[modelScreen] download error:', err)
      Alert.alert('ダウンロードエラー', err?.message ?? String(err))
    } finally {
      setProgressMap((prev) => {
        const next = { ...prev }
        delete next[model.id]
        return next
      })
    }
  }

  const onCancelDownload = async (model) => {
    await cancelDownload(model)
    setProgressMap((prev) => {
      const next = { ...prev }
      delete next[model.id]
      return next
    })
  }

  const onUse = (model) => {
    if (model.id === activeModelId) return
    setActiveModelId(model.id)
  }

  const onDelete = (model) => {
    if (model.id === activeModelId) {
      Alert.alert(
        '削除できません',
        '現在使用中のモデルは削除できません。先に別のモデルに切り替えてから削除してください。',
      )
      return
    }
    Alert.alert(
      'モデルを削除しますか？',
      `${model.label} の本体ファイルを削除します。再度使う場合はダウンロードし直しが必要です。`,
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '削除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteModel(model)
              await refreshStatus()
            } catch (err) {
              console.warn('[modelScreen] delete error:', err)
              Alert.alert('削除エラー', err?.message ?? String(err))
            }
          },
        },
      ],
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.root}>
      <Text style={styles.desc}>
        チャットで使うローカル LLM を管理します。大きいモデルほど精度が上がりますが、
        ダウンロード容量と動作速度の負荷も上がります。
      </Text>

      {statusLoading && (
        <View style={styles.statusBox}>
          <ActivityIndicator color={colors.lightPurple} />
          <Text style={styles.statusText}>ダウンロード状況を確認中…</Text>
        </View>
      )}

      {LLM_MODELS.map((m) => {
        const isActive = m.id === activeModelId
        const isDownloaded = downloadedIds.has(m.id)
        const progress = progressMap[m.id]
        const isDownloading = progress != null
        const pct = Math.round((progress ?? 0) * 100)

        return (
          <View
            key={m.id}
            style={[styles.card, isActive && styles.cardActive]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{m.label}</Text>
              <View style={[styles.badge, isActive && styles.badgeActive]}>
                <Text style={[styles.badgeText, isActive && styles.badgeTextActive]}>
                  {isActive ? '使用中' : m.badge}
                </Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{m.description}</Text>
            <Text style={styles.cardMeta}>
              サイズ目安: {formatSize(m.approxSizeMb)}
              {isDownloaded ? '  ・  ✓ ダウンロード済み' : ''}
            </Text>

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
                  onPress={() => onCancelDownload(m)}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnSecondary,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.btnSecondaryText}>キャンセル</Text>
                </Pressable>
              ) : isDownloaded ? (
                <>
                  {!isActive && (
                    <Pressable
                      onPress={() => onUse(m)}
                      style={({ pressed }) => [
                        styles.btn,
                        styles.btnPrimary,
                        pressed && styles.btnPressed,
                      ]}
                    >
                      <Text style={styles.btnPrimaryText}>使用する</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => onDelete(m)}
                    disabled={isActive}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.btnSecondary,
                      isActive && styles.btnDisabled,
                      pressed && !isActive && styles.btnPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.btnSecondaryText,
                        styles.btnDanger,
                        isActive && styles.btnDisabledText,
                      ]}
                    >
                      削除
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => onDownload(m)}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnPrimary,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.btnPrimaryText}>ダウンロード</Text>
                </Pressable>
              )}
            </View>
          </View>
        )
      })}

      <Text style={styles.note}>
        ※ ダウンロード済みのモデルにのみ切り替えできます。{'\n'}
        ※ 使用中のモデルは削除できません。先に別のモデルに切り替えてください。{'\n'}
        ※ tokenizer ファイルは Qwen3 系で共通のため、削除しても残ります。
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: { padding: 20, paddingBottom: 40 },
  desc: {
    fontSize: fontSize.middle,
    color: colors.gray,
    marginBottom: 20,
    lineHeight: 20,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f3fb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  statusText: { marginLeft: 8, color: colors.darkPurple, fontSize: fontSize.middle },
  card: {
    backgroundColor: '#fafafe',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e2f0',
  },
  cardActive: {
    backgroundColor: '#f4f3fb',
    borderColor: colors.lightPurple,
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.darkPurple,
    flexShrink: 1,
  },
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
  cardDesc: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    marginBottom: 4,
    lineHeight: 20,
  },
  cardMeta: { fontSize: fontSize.small, color: colors.gray },
  progressWrap: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#e5e2f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginRight: 8,
  },
  progressFill: { height: '100%', backgroundColor: colors.lightPurple },
  progressText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    minWidth: 40,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.lightPurple },
  btnPrimaryText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#dcd9ec',
  },
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
