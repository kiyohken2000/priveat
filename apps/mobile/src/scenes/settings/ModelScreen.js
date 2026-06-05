import { useFocusEffect } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
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
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { canRunOnDevice, getDeviceRamBytes } from '../../utils/deviceRam'
import {
  getDeviceTier,
  getRecommendation,
  getRoleGuidanceForTier,
} from '../../utils/modelRecommendation'
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

const roleLabel = (role) =>
  role === 'coach' ? 'コーチ用'
  : role === 'vision' ? '写真認識'
  : '記録用'

// kind='vision' のモデルは vision タブにのみ、それ以外は parser/coach タブにのみ表示。
const modelKindForRole = (role) => (role === 'vision' ? 'vision' : 'text')
const modelMatchesRole = (model, role) => (model.kind ?? 'text') === modelKindForRole(role)

// 現在 LLMProvider がロード中のモデルに対するステータス行。
//   - error あり    → エラー文（赤）
//   - isReady       → ロード済み（緑チェック）
//   - DL 中 (0<p<1) → ダウンロード中 XX%（青、ActivityIndicator）
//   - それ以外      → ロード中（青、ActivityIndicator）
const ActiveStatusRow = ({ llm }) => {
  if (llm.error) {
    return (
      <View style={styles.statusRow}>
        <Text style={[styles.statusRowText, styles.statusError]} numberOfLines={2}>
          ⚠ ロード失敗: {String(llm.error.message ?? llm.error)}
        </Text>
      </View>
    )
  }
  if (llm.isReady) {
    return (
      <View style={styles.statusRow}>
        <Text style={[styles.statusRowText, styles.statusReady]}>
          ✓ ロード済み（チャットですぐに使えます）
        </Text>
      </View>
    )
  }
  const pct = Math.round((llm.downloadProgress ?? 0) * 100)
  const downloading = pct > 0 && pct < 100
  return (
    <View style={styles.statusRow}>
      <ActivityIndicator size="small" color={colors.lightPurple} />
      <Text style={[styles.statusRowText, styles.statusLoading]}>
        {downloading ? `ダウンロード中 ${pct}%` : 'モデルをロード中…'}
      </Text>
    </View>
  )
}

const RoleTabs = ({ selected, onChange }) => (
  <View style={styles.tabs}>
    {['parser', 'coach', 'vision'].map((role) => {
      const isActive = role === selected
      return (
        <Pressable
          key={role}
          onPress={() => onChange(role)}
          style={({ pressed }) => [
            styles.tab,
            isActive && styles.tabActive,
            pressed && !isActive && styles.tabPressed,
          ]}
        >
          <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
            {roleLabel(role)}
          </Text>
        </Pressable>
      )
    })}
  </View>
)

export default function ModelScreen() {
  const {
    parserModelId,
    coachModelId,
    visionModelId,
    setParserModelId,
    setCoachModelId,
    setVisionModelId,
    currentRole,
  } = useActiveModel()
  // 現在ロード中のモデル（currentRole に対応）の状態。
  // 開いているタブと currentRole が一致するときだけステータス行を表示する。
  const llm = useActiveLLM()

  // 端末スペック判定はマウント時に 1 回だけ評価。RAM は起動中に変わらない。
  const ramBytes = useMemo(() => getDeviceRamBytes(), [])
  const deviceTier = useMemo(() => getDeviceTier(ramBytes), [ramBytes])

  // 設定画面で「いま編集対象にしているロール」。currentRole とは独立。
  // 例: 起動時 currentRole='parser' (記録用) でも、ユーザーが「コーチ用」タブを開いて
  //     coach 用モデルを変更することができる。
  const [selectedRole, setSelectedRole] = useState('parser')
  const targetModelId =
    selectedRole === 'coach' ? coachModelId
    : selectedRole === 'vision' ? visionModelId
    : parserModelId
  const setTargetModelId =
    selectedRole === 'coach' ? setCoachModelId
    : selectedRole === 'vision' ? setVisionModelId
    : setParserModelId

  // タブで絞り込み: vision タブは vision モデルだけ、parser/coach は text モデルだけ表示。
  const visibleModels = useMemo(
    () => LLM_MODELS.filter((m) => modelMatchesRole(m, selectedRole)),
    [selectedRole],
  )

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

  // モデルを開いているタブのロールに割り当てる。
  // すでに同じロールに割り当てられている場合は何もしない（同一切替防止）。
  const onUse = (model) => {
    if (model.id === targetModelId) return
    const isLarge = model.approxSizeMb >= 1000
    const proceed = () => setTargetModelId(model.id)
    if (isLarge) {
      Alert.alert(
        '大きいモデルです',
        `${model.label} (${formatSize(model.approxSizeMb)}) を「${roleLabel(selectedRole)}」に設定します。\n\n端末のメモリが不足するとアプリがクラッシュする可能性があります。クラッシュした場合は次回起動時に自動でデフォルトモデルに戻ります。\n\n続行しますか？`,
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: '設定する', onPress: proceed },
        ],
      )
    } else {
      proceed()
    }
  }

  // parser / coach / vision いずれかで使用中のモデルは削除不可。
  const onDelete = (model) => {
    const usedByParser = model.id === parserModelId
    const usedByCoach = model.id === coachModelId
    const usedByVision = model.id === visionModelId
    if (usedByParser || usedByCoach || usedByVision) {
      const roles = []
      if (usedByParser) roles.push('記録用')
      if (usedByCoach) roles.push('コーチ用')
      if (usedByVision) roles.push('写真認識')
      Alert.alert(
        '削除できません',
        `このモデルは「${roles.join(' / ')}」で使用中です。先に別のモデルに切り替えてから削除してください。`,
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
        チャットで使うローカル LLM を管理します。{'\n'}
        「記録用」は食事内容の構造化、「コーチ用」はコーチ応答、「写真認識」は料理写真の認識に使います。
        必要に応じて自動で切り替わります（同時にロードはしません）。
      </Text>

      <View style={styles.deviceBanner}>
        <Text style={styles.deviceBannerTitle}>
          📱 この端末: {deviceTier.ramGb != null ? `約 ${deviceTier.ramGb.toFixed(1)} GB · ` : ''}
          {deviceTier.label}
        </Text>
        <Text style={styles.deviceBannerHint}>
          {getRoleGuidanceForTier(deviceTier, selectedRole)}
        </Text>
      </View>

      <RoleTabs selected={selectedRole} onChange={setSelectedRole} />

      <Text style={styles.tabDesc}>
        {selectedRole === 'parser'
          ? '記録用: 軽量モデルでも十分。速度を優先しましょう。'
          : selectedRole === 'vision'
            ? '写真認識: 料理写真から料理名を抽出します。軽量モデルで十分。'
            : 'コーチ用: 重めのモデルで応答品質が上がります。'}
      </Text>

      {statusLoading && (
        <View style={styles.statusBox}>
          <ActivityIndicator color={colors.lightPurple} />
          <Text style={styles.statusBoxText}>ダウンロード状況を確認中…</Text>
        </View>
      )}

      {visibleModels.map((m) => {
        const isSelectedForRole = m.id === targetModelId
        const usedByParser = m.id === parserModelId
        const usedByCoach = m.id === coachModelId
        const usedByVision = m.id === visionModelId
        // 同タブ内（同 kind）で別ロールの使用中表示。vision タブは vision モデルのみなので
        // 「他ロールで使用中」は parser/coach タブの相互だけ発生する。
        const usedByOtherRole =
          (selectedRole === 'parser' && usedByCoach && !isSelectedForRole) ||
          (selectedRole === 'coach' && usedByParser && !isSelectedForRole)
        const isLoadedHere = currentRole === selectedRole && isSelectedForRole

        const isDownloaded = downloadedIds.has(m.id)
        const progress = progressMap[m.id]
        const isDownloading = progress != null
        const pct = Math.round((progress ?? 0) * 100)
        const compat = canRunOnDevice(m, ramBytes)
        const unsupported = !compat.ok
        const recommendation = getRecommendation(m, selectedRole, ramBytes)
        const isRecommended = recommendation === 'recommended'

        // 削除は parser / coach / vision のいずれでも未使用のときのみ可能。
        const inUseSomewhere = usedByParser || usedByCoach || usedByVision

        return (
          <View
            key={m.id}
            style={[
              styles.card,
              isSelectedForRole && styles.cardActive,
              !isSelectedForRole && usedByOtherRole && styles.cardSecondary,
              unsupported && styles.cardUnsupported,
            ]}
          >
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleWrap}>
                <Text style={styles.cardTitle}>{m.label}</Text>
                {isRecommended && !isSelectedForRole && (
                  <View style={styles.recommendPill}>
                    <Text style={styles.recommendPillText}>★ 推奨</Text>
                  </View>
                )}
              </View>
              <View
                style={[
                  styles.badge,
                  isSelectedForRole && styles.badgeActive,
                  !isSelectedForRole && usedByOtherRole && styles.badgeSecondary,
                  unsupported && !isSelectedForRole && styles.badgeUnsupported,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isSelectedForRole && styles.badgeTextActive,
                    !isSelectedForRole && usedByOtherRole && styles.badgeTextSecondary,
                    unsupported && !isSelectedForRole && styles.badgeTextUnsupported,
                  ]}
                >
                  {isSelectedForRole
                    ? `${roleLabel(selectedRole)}で使用中`
                    : usedByOtherRole
                      ? `${roleLabel(selectedRole === 'parser' ? 'coach' : 'parser')}で使用中`
                      : unsupported
                        ? '非対応'
                        : m.badge}
                </Text>
              </View>
            </View>
            <Text style={styles.cardDesc}>{m.description}</Text>
            <Text style={styles.cardMeta}>
              サイズ目安: {formatSize(m.approxSizeMb)}
              {isDownloaded ? '  ・  ✓ ダウンロード済み' : ''}
            </Text>

            {/* ステータス: 開いているタブと currentRole が一致するときだけ詳細を表示。
                不一致の場合は「待機中」のヒントだけ。 */}
            {isLoadedHere && llm && <ActiveStatusRow llm={llm} />}
            {isSelectedForRole && !isLoadedHere && (
              <Text style={styles.statusIdle}>
                ⏸ 待機中（{roleLabel(selectedRole)}に切り替わるとロードされます）
              </Text>
            )}

            {unsupported && (
              <Text style={styles.cardWarn}>⚠ {compat.reason}</Text>
            )}

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
                  {!isSelectedForRole && (
                    <Pressable
                      onPress={() => onUse(m)}
                      disabled={unsupported}
                      style={({ pressed }) => [
                        styles.btn,
                        styles.btnPrimary,
                        unsupported && styles.btnDisabled,
                        pressed && !unsupported && styles.btnPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.btnPrimaryText,
                          unsupported && styles.btnDisabledText,
                        ]}
                      >
                        {roleLabel(selectedRole)}に設定
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => onDelete(m)}
                    disabled={inUseSomewhere}
                    style={({ pressed }) => [
                      styles.btn,
                      styles.btnSecondary,
                      inUseSomewhere && styles.btnDisabled,
                      pressed && !inUseSomewhere && styles.btnPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.btnSecondaryText,
                        styles.btnDanger,
                        inUseSomewhere && styles.btnDisabledText,
                      ]}
                    >
                      削除
                    </Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  onPress={() => onDownload(m)}
                  disabled={unsupported}
                  style={({ pressed }) => [
                    styles.btn,
                    styles.btnPrimary,
                    unsupported && styles.btnDisabled,
                    pressed && !unsupported && styles.btnPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.btnPrimaryText,
                      unsupported && styles.btnDisabledText,
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
        ※ ダウンロード済みのモデルにのみ切り替えできます。{'\n'}
        ※ いずれかのロールで使用中のモデルは削除できません。{'\n'}
        ※ tokenizer ファイルは同系列モデルで共通のため、削除しても残ります。
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
    marginBottom: 16,
    lineHeight: 20,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#f4f3fb',
    borderRadius: 10,
    padding: 4,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: { backgroundColor: colors.lightPurple },
  tabPressed: { opacity: 0.7 },
  tabText: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  tabTextActive: { color: colors.white },
  tabDesc: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 16,
    lineHeight: 18,
  },
  deviceBanner: {
    backgroundColor: '#f4f3fb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderLeftWidth: 3,
    borderLeftColor: colors.lightPurple,
  },
  deviceBannerTitle: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
    marginBottom: 2,
  },
  deviceBannerHint: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    lineHeight: 18,
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f3fb',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  statusBoxText: {
    marginLeft: 8,
    color: colors.darkPurple,
    fontSize: fontSize.middle,
  },
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
  cardSecondary: {
    borderColor: '#cfc8e5',
    borderWidth: 1,
  },
  cardUnsupported: {
    opacity: 0.6,
  },
  badgeUnsupported: { backgroundColor: '#f4d4d4' },
  badgeTextUnsupported: { color: '#a33' },
  badgeSecondary: { backgroundColor: '#e0d8f0' },
  badgeTextSecondary: { color: colors.darkPurple },
  cardWarn: {
    fontSize: fontSize.small,
    color: '#a33',
    marginTop: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  statusRowText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    flexShrink: 1,
  },
  statusReady: { color: '#2a7' },
  statusLoading: { color: colors.lightPurple },
  statusError: { color: '#a33' },
  statusIdle: {
    marginTop: 8,
    fontSize: fontSize.small,
    color: colors.gray,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  // タイトル + 推奨ピルをまとめる左ブロック。残り幅を取って右側 badge と並ぶ。
  cardTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: 6,
  },
  cardTitle: {
    fontSize: fontSize.large,
    fontWeight: '700',
    color: colors.darkPurple,
    flexShrink: 1,
  },
  recommendPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#fff4c2',
    borderWidth: 1,
    borderColor: '#e6c34a',
  },
  recommendPillText: {
    fontSize: 10,
    color: '#7a5a00',
    fontWeight: '700',
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
