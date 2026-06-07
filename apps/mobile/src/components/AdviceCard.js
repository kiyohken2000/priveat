import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import LottieView from 'lottie-react-native'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../theme'
import { useActiveLLM, useActiveModel } from '../state/modelContext'
import {
  generateAdvice,
  generateWeeklyAdvice,
  inspectAdvice,
  inspectWeeklyAdvice,
} from '../coaching/advice'
import { pickMascotForDate } from '../coaching/mascot'

// Today (Home) / 過去日 (DayDetail) 共通の AI アドバイス表示カード。
//
// 動作:
//   1. マウント時にキャッシュを確認 → あれば即表示
//   2. ユーザーがボタンをタップ → coach モデルへ swap → 生成 → DB に保存 → 表示更新
//   3. 入力データやスタンスが変わって snapshot_hash がずれている場合は stale バッジ表示
//
// LLM 呼び出しは llm.generate() のワンショット (messageHistory を汚さない)。
//
// 注意: setCurrentRole('coach') によりグローバルなロール状態が変わる。
//   Chat 画面に戻った際に log モードなら自動で parser へ再 swap が走る (Chat 側の
//   useEffect が処理) ため、ここではロールを戻さない。

const MARKDOWN_STYLE = {
  paragraph: { color: colors.black, fontSize: fontSize.middle, marginTop: 0, marginBottom: 6 },
  h1: { color: colors.darkPurple, fontSize: 18, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  h2: { color: colors.darkPurple, fontSize: 17, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  h3: { color: colors.darkPurple, fontSize: 16, fontWeight: '700', marginTop: 2, marginBottom: 4 },
  list: { color: colors.black, fontSize: fontSize.middle, marginBottom: 6, bulletColor: colors.lightPurple },
  strong: { color: colors.darkPurple },
  blockquote: { color: colors.darkPurple, borderColor: colors.lightPurple, borderWidth: 3, backgroundColor: 'transparent' },
  code: { color: colors.darkPurple, backgroundColor: '#efedf7', fontFamily: 'Courier' },
}

const formatGeneratedAt = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
  } catch (e) {
    return ''
  }
}

// period:
//   - 'day'  : date を YYYY-MM-DD として 1 日アドバイス (coach_advice)
//   - 'week' : date を週初め (YYYY-MM-DD) として直近 7 日サマリーアドバイス (coach_weekly_advice)
export default function AdviceCard({ date, kind = 'today', period = 'day' }) {
  const llm = useActiveLLM()
  const {
    currentRole,
    setCurrentRole,
    coachModel,
    coachModelId,
    parserModelId,
  } = useActiveModel()

  const [cached, setCached] = useState(null)
  const [isStale, setIsStale] = useState(false)
  const [loadingInspect, setLoadingInspect] = useState(true)
  const [phase, setPhase] = useState('idle') // 'idle' | 'awaiting-swap' | 'generating' | 'error'
  const [error, setError] = useState(null)

  const isWeekly = period === 'week'

  // 日付ごとに同じマスコットが出るようにする (同じ日に何度開いても顔が変わらない)。
  const mascotSource = useMemo(() => pickMascotForDate(date), [date])

  // 「ユーザーがボタンを押した」フラグ。setCurrentRole の swap 完了 (isReady) を
  // 待ってから generate を 1 回だけ走らせるためのトリガ。
  const pendingGenRef = useRef(false)
  // swap が必要なケース (parser → coach、モデルが違う) では、useLLM の isReady が
  // 古い parser の状態のまま true に見える 1 レンダの隙間がある。
  // 「isReady が一度 false に落ちる」のを観測してから true 復帰を待つ。
  // 同モデル (parser==coach) や、coach のまま load 待ち中の場合は false 観測が
  // 来ないので requireSwapRef=false で skip する。
  const requireSwapRef = useRef(false)
  const swapObservedRef = useRef(false)

  const clearPendingFlags = () => {
    pendingGenRef.current = false
    requireSwapRef.current = false
    swapObservedRef.current = false
  }

  const reloadInspect = useCallback(async () => {
    if (!date) return
    setLoadingInspect(true)
    try {
      const result = isWeekly
        ? await inspectWeeklyAdvice({ weekStart: date, modelId: coachModelId })
        : await inspectAdvice({ date, modelId: coachModelId })
      setCached(result.cached)
      setIsStale(result.isStale)
    } catch (e) {
      console.warn('[adviceCard] inspect failed:', e)
    } finally {
      setLoadingInspect(false)
    }
  }, [date, coachModelId, isWeekly])

  useEffect(() => {
    reloadInspect()
  }, [reloadInspect])

  // 生成本体。currentRole === 'coach' && llm.isReady の状態でしか呼ばない。
  const runGenerate = useCallback(async () => {
    setPhase('generating')
    setError(null)
    try {
      if (isWeekly) {
        await generateWeeklyAdvice({ weekStart: date, llm, modelId: coachModelId })
      } else {
        await generateAdvice({ date, llm, modelId: coachModelId, kind })
      }
      await reloadInspect()
      setPhase('idle')
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    } catch (e) {
      console.warn('[adviceCard] generate failed:', e)
      setError(e?.message ?? String(e))
      setPhase('error')
    }
  }, [date, llm, coachModelId, kind, reloadInspect, isWeekly])

  // 「待機中: coach に切替→ ready 待ち」の遷移を監視。
  // requireSwap=true (実 swap が起きるケース) のときは「isReady=false を一度観測」する
  // までは早期 return する。これが無いと swap 開始前の stale な isReady=true を見て
  // generate を投げてしまい「model not loaded」エラーになる。
  useEffect(() => {
    if (phase !== 'awaiting-swap') return
    if (requireSwapRef.current && !swapObservedRef.current) {
      if (llm?.isReady === false) swapObservedRef.current = true
      return
    }
    if (!llm?.isReady) return
    if (currentRole !== 'coach') return
    if (llm.isGenerating) return
    if (!pendingGenRef.current) return
    clearPendingFlags()
    runGenerate()
  }, [phase, llm?.isReady, llm?.isGenerating, currentRole, runGenerate])

  const onPressGenerate = useCallback(async () => {
    if (!llm) return
    if (phase === 'generating' || phase === 'awaiting-swap') return
    if (llm.isGenerating) return
    setError(null)
    if (currentRole !== 'coach') {
      // coach モデルへ swap を要求 → useEffect 側で ready を待って自動 run。
      // parser と coach が別モデルのときは実 swap が起きるので requireSwap=true。
      // 同モデルの場合は swap せず isReady が落ちないので false で skip させる。
      pendingGenRef.current = true
      requireSwapRef.current = parserModelId !== coachModelId
      swapObservedRef.current = false
      setPhase('awaiting-swap')
      try {
        await setCurrentRole('coach')
      } catch (e) {
        clearPendingFlags()
        setError(e?.message ?? String(e))
        setPhase('error')
      }
      return
    }
    if (!llm.isReady) {
      // ロード中 (起動直後など) ならフラグだけ立てて ready を待つ (swap は起きていない)
      pendingGenRef.current = true
      requireSwapRef.current = false
      swapObservedRef.current = false
      setPhase('awaiting-swap')
      return
    }
    runGenerate()
  }, [llm, currentRole, setCurrentRole, phase, runGenerate, parserModelId, coachModelId])

  // --- 描画 ---------------------------------------------------------------

  if (loadingInspect) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <FontIcon name="lightbulb-o" size={16} color={colors.lightPurple} />
          <Text style={styles.title}>AI からのアドバイス</Text>
        </View>
        <ActivityIndicator size="small" color={colors.lightPurple} style={{ marginTop: 8 }} />
      </View>
    )
  }

  const isWorking = phase === 'awaiting-swap' || phase === 'generating'
  const showCached = !!cached?.advice_text
  const buttonLabel = showCached ? '再生成' : 'アドバイスをもらう'
  const workingLabel =
    phase === 'awaiting-swap' ? 'コーチモデルを準備中...' : 'アドバイスを生成中...'

  // マスコット + 吹き出しを出すかどうか。アドバイス未生成 (placeholder 状態) では非表示。
  const showMascot = isWorking || showCached

  // 吹き出し内に何を表示するか。working > cached の優先度。
  const renderBubbleContent = () => {
    if (isWorking) {
      return (
        <View style={styles.workingRow}>
          <ActivityIndicator size="small" color={colors.lightPurple} />
          <Text style={styles.workingText}>{workingLabel}</Text>
        </View>
      )
    }
    // showCached 前提 (showMascot で囲まれる側でしか呼ばない)
    return (
      <>
        <EnrichedMarkdownText
          markdown={cached.advice_text}
          markdownStyle={MARKDOWN_STYLE}
          flavor="github"
          allowTrailingMargin={false}
          selectable
        />
        <Text style={styles.meta}>
          {formatGeneratedAt(cached.generated_at)} · {cached.model_id ?? '不明モデル'}
        </Text>
      </>
    )
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <FontIcon name="lightbulb-o" size={16} color={colors.lightPurple} />
        <Text style={styles.title}>
          {isWeekly ? '週次 AI アドバイス' : 'AI からのアドバイス'}
        </Text>
        {isStale && showCached && (
          <View style={styles.staleBadge}>
            <Text style={styles.staleBadgeText}>データが更新されました</Text>
          </View>
        )}
      </View>

      {showMascot ? (
        <View style={styles.speechRow}>
          <View style={styles.mascotWrap}>
            <View style={styles.mascotClip}>
              <LottieView
                source={mascotSource}
                style={styles.mascot}
                autoPlay
                loop
              />
            </View>
          </View>
          <View style={styles.bubbleWrap}>
            <View style={styles.bubbleTail} />
            <View style={styles.bubble}>
              {renderBubbleContent()}
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.placeholder}>
          {isWeekly
            ? `ボタンを押すとコーチモデル (${coachModel?.label ?? '未選択'}) で直近 7 日のサマリーから来週へのヒントを生成します。`
            : `ボタンを押すとコーチモデル (${coachModel?.label ?? '未選択'}) で短いアドバイスを生成します。`}
        </Text>
      )}

      {error ? <Text style={styles.errorText}>エラー: {error}</Text> : null}

      <Pressable
        onPress={onPressGenerate}
        disabled={isWorking || llm?.isGenerating}
        style={({ pressed }) => [
          styles.button,
          (isWorking || llm?.isGenerating) && styles.buttonDisabled,
          pressed && styles.buttonPressed,
        ]}
      >
        {isWorking ? (
          <>
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={styles.buttonText}>{workingLabel}</Text>
          </>
        ) : (
          <>
            <FontIcon name="magic" size={14} color={colors.white} />
            <Text style={styles.buttonText}>{buttonLabel}</Text>
          </>
        )}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
    borderWidth: 1,
    borderColor: '#f0eef7',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    flex: 1,
  },
  staleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#ffb74d',
  },
  staleBadgeText: { fontSize: 10, color: '#e65100' },
  speechRow: {
    // 縦並び。マスコットは左寄せにして、吹き出しのしっぽがマスコット中央を指すように配置する。
    flexDirection: 'column',
    alignItems: 'stretch',
    marginBottom: 8,
  },
  mascotWrap: {
    width: 200,
    height: 200,
    alignSelf: 'center',
    borderRadius: 16,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  mascotClip: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  mascot: {
    width: 200,
    height: 200,
  },
  bubbleWrap: {
    position: 'relative',
    // mascot とくっつきすぎないよう少し離す (tail の出っ張り 8px 含む)。
    marginTop: 2,
  },
  // 吹き出し本体。背景色は単色で、しっぽ (bubbleTail) と同じ色を使う。
  bubble: {
    backgroundColor: '#fafafe',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 60,
    justifyContent: 'center',
  },
  // 吹き出しの「しっぽ」: 上向きの三角形 (マスコットを指す)。
  // mascot が中央寄せなので、吹き出し中央 (= mascot 中央) に来るよう left:50% + marginLeft:-8。
  bubbleTail: {
    position: 'absolute',
    top: -7,
    left: '50%',
    marginLeft: -8,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#fafafe',
  },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workingText: {
    fontSize: fontSize.small,
    color: colors.gray,
  },
  placeholder: {
    fontSize: fontSize.small,
    color: colors.gray,
    lineHeight: 18,
    marginBottom: 8,
  },
  meta: {
    fontSize: 10,
    color: colors.gray,
    marginTop: 6,
    textAlign: 'right',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.lightPurple,
    borderRadius: 10,
    paddingVertical: 10,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.middle,
    fontWeight: '600',
  },
  errorText: {
    fontSize: fontSize.small,
    color: colors.redPrimary,
    marginBottom: 8,
  },
})
