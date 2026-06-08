import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../../theme'
import { LLM_MODELS } from '../../data/llmModels'
import { LLM_LLAMA_RN_TEXT_MODELS } from '../../data/llmTextModelsLlamaRn'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { parseRecordOutput } from '../chat/schema'
import { buildSystemPrompt as buildParserSystemPrompt } from '../chat/Chat'
import { buildCoachSystemPrompt } from '../../coaching/prompts'
import { buildCoachingContext } from '../../coaching/context'
import {
  isLlamaRnTextModelDownloaded,
  downloadLlamaRnTextModel,
  deleteLlamaRnTextModel,
} from '../../services/llmTextModelStorage'
import { runWithLlamaRnText } from '../../state/llmTextOrchestrator'
import { listDownloadedModelIds, downloadModel } from '../../services/modelStorage'

// モデル比較画面。
//
// 目的:
//   - 同じテスト入力を複数モデルに順番に投げ、応答 / 所要時間 / parser ならパース成否を比較する。
//   - 日本語精度や JSON 構造化出力の精度を実機で測るための簡易ベンチ。
//
// 対応エンジン:
//   - executorch (`useLLM`): 既存の LLM_MODELS。 `coach` 枠を一時的に拝借して swap する。
//   - llama.rn (GGUF): LLM_LLAMA_RN_TEXT_MODELS。 LFM2.5-1.2B-JP のような executorch に
//     `.pte` が無いモデルを試すための β 経路。VLM と同じ runWithLlamaRn* 排他制御で
//     executorch を退避→ llama.rn 実行 → executorch 復帰の順で動く。
//
// 制約 / 割り切り:
//   - 実行中は Chat / Home の AdviceCard が開かれていると swap が競合するので「実行中は他画面を開かない」と注意書き
//   - 1 モデルあたりロード 15-30 秒 + 推論数秒。 N モデルで N × ~30s かかる
//   - 結果は画面の state にだけ保持 (永続化しない、画面を閉じると消える)
//   - llama.rn モデルは未 DL のときチェックボックスが押せない (DL ボタンを先に押す)

const PRESETS = {
  parser: [
    'カツ丼と缶チューハイ2本',
    '30分で3キロ走った',
    '体重68.5kg',
    'ごはん大盛りとバナナ1本と焼き魚',
    '体重70.2',
  ],
  coach: [
    '今週どうだった?',
    '炭水化物多すぎる?',
    'もう少し痩せるには?',
    '今日の調子は?',
    '何を意識すべき?',
  ],
}

// Phase 1 (isReady=false に落ちる) のタイムアウト。
// parser/coach が同一モデル ID のときは swap が走らず isReady が落ちないので、これを過ぎたら
// 「すでに目的モデルがロード済み」とみなして直ちに次フェーズへ進む。
const PHASE1_TIMEOUT_MS = 5_000
// Phase 2 (isReady=true に戻る) のタイムアウト。1.7B+ で初回 DL が走ると数十秒かかる。
const PHASE2_TIMEOUT_MS = 180_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isLlamaRn = (m) => m.engine === 'llama_rn'

export default function BenchmarkScreen() {
  const [role, setRole] = useState('parser')
  const [input, setInput] = useState(PRESETS.parser[0])
  // 初期選択は空 (DL 状態に依存しない見た目にする。DL 済みの中からユーザーが選ぶ)
  const [selected, setSelected] = useState(new Set())
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(null) // { i, total, modelLabel, phase }
  const [results, setResults] = useState([])

  // llama.rn モデルの DL 状態 / 進捗管理
  // downloaded: { [modelId]: boolean }
  // downloadProgress: { [modelId]: number 0..1 } (DL 中のみ)
  const [downloaded, setDownloaded] = useState({})
  const [downloadProgress, setDownloadProgress] = useState({})

  const llm = useActiveLLM()
  const llmRef = useRef(llm)
  useEffect(() => {
    llmRef.current = llm
  }, [llm])

  const modelCtx = useActiveModel()
  const {
    coachModelId,
    currentRole,
    setCoachModelId,
    setCurrentRole,
  } = modelCtx
  const coachModelIdRef = useRef(coachModelId)
  const currentRoleRef = useRef(currentRole)
  useEffect(() => {
    coachModelIdRef.current = coachModelId
  }, [coachModelId])
  useEffect(() => {
    currentRoleRef.current = currentRole
  }, [currentRole])

  // 初回マウントで全モデル (executorch + llama.rn) の DL 済みフラグを取得。
  // executorch は listDownloadedModelIds (ExpoResourceFetcher の DL 一覧と照合)、
  // llama.rn は GGUF ファイルの存在チェックで判定する。
  const refreshDownloaded = useCallback(async () => {
    const next = {}
    try {
      const ids = await listDownloadedModelIds(LLM_MODELS)
      const set = new Set(ids)
      for (const m of LLM_MODELS) next[m.id] = set.has(m.id)
    } catch (e) {
      for (const m of LLM_MODELS) next[m.id] = false
    }
    for (const m of LLM_LLAMA_RN_TEXT_MODELS) {
      try {
        next[m.id] = await isLlamaRnTextModelDownloaded(m)
      } catch (e) {
        next[m.id] = false
      }
    }
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next = await refreshDownloaded()
      if (!cancelled) setDownloaded(next)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshDownloaded])

  const toggleModel = useCallback(
    (id, opts = {}) => {
      if (opts.disabled) return
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    [],
  )

  const onPickRole = useCallback(
    (r) => {
      if (running) return
      setRole(r)
      setInput(PRESETS[r][0])
      setResults([])
    },
    [running],
  )

  const onPickPreset = useCallback(
    (p) => {
      if (running) return
      setInput(p)
    },
    [running],
  )

  // executorch モデルのダウンロード (ExpoResourceFetcher 経由)。
  // 既存の ModelScreen と同じ仕組み。完了後に downloaded を再取得する。
  const onDownloadExecutorch = useCallback(async (model) => {
    if (downloadProgress[model.id] != null) return
    if (downloaded[model.id]) return
    setDownloadProgress((prev) => ({ ...prev, [model.id]: 0 }))
    try {
      await downloadModel(model, (p) => {
        setDownloadProgress((prev) => ({ ...prev, [model.id]: p }))
      })
      setDownloaded((prev) => ({ ...prev, [model.id]: true }))
    } catch (e) {
      Alert.alert('ダウンロード失敗', e?.message ?? String(e))
    } finally {
      setDownloadProgress((prev) => {
        const next = { ...prev }
        delete next[model.id]
        return next
      })
    }
  }, [downloaded, downloadProgress])

  // llama.rn モデルのダウンロード
  const onDownloadLlamaRn = useCallback(async (model) => {
    if (downloadProgress[model.id] != null) return // 進行中
    if (downloaded[model.id]) return
    setDownloadProgress((prev) => ({ ...prev, [model.id]: 0 }))
    try {
      await downloadLlamaRnTextModel(model, (p) => {
        setDownloadProgress((prev) => ({ ...prev, [model.id]: p }))
      })
      setDownloaded((prev) => ({ ...prev, [model.id]: true }))
    } catch (e) {
      Alert.alert('ダウンロード失敗', e?.message ?? String(e))
    } finally {
      setDownloadProgress((prev) => {
        const next = { ...prev }
        delete next[model.id]
        return next
      })
    }
  }, [downloaded, downloadProgress])

  // llama.rn モデルの削除 (容量確保用)
  const onDeleteLlamaRn = useCallback(async (model) => {
    try {
      await deleteLlamaRnTextModel(model)
      setDownloaded((prev) => ({ ...prev, [model.id]: false }))
      setSelected((prev) => {
        if (!prev.has(model.id)) return prev
        const next = new Set(prev)
        next.delete(model.id)
        return next
      })
    } catch (e) {
      console.warn('[benchmark] delete error:', e)
      Alert.alert('削除失敗', e?.message ?? String(e))
    }
  }, [])

  // executorch モデルに swap して isReady を待つ
  const swapToExecutorchModel = useCallback(
    async (modelId) => {
      const t0 = Date.now()
      const wasSameModel = coachModelIdRef.current === modelId && currentRoleRef.current === 'coach'
      await setCoachModelId(modelId)
      if (currentRoleRef.current !== 'coach') {
        await setCurrentRole('coach')
      }
      if (wasSameModel) {
        const start = Date.now()
        while (Date.now() - start < 2_000) {
          if (llmRef.current?.isReady && !llmRef.current?.isGenerating) {
            return { loadMs: Date.now() - t0, ok: true }
          }
          await sleep(100)
        }
        return llmRef.current?.isReady
          ? { loadMs: Date.now() - t0, ok: true }
          : { loadMs: Date.now() - t0, ok: false, error: 'モデルが ready になりませんでした' }
      }
      // Phase 1: isReady=false に落ちるのを待つ
      const phase1Start = Date.now()
      let swapStarted = false
      while (Date.now() - phase1Start < PHASE1_TIMEOUT_MS) {
        if (!llmRef.current?.isReady) {
          swapStarted = true
          break
        }
        await sleep(50)
      }
      if (!swapStarted) {
        return { loadMs: Date.now() - t0, ok: true }
      }
      // Phase 2: isReady=true に戻るのを待つ
      const phase2Start = Date.now()
      while (Date.now() - phase2Start < PHASE2_TIMEOUT_MS) {
        const cur = llmRef.current
        if (cur?.isReady && !cur?.isGenerating) {
          return { loadMs: Date.now() - t0, ok: true }
        }
        await sleep(200)
      }
      return {
        loadMs: Date.now() - t0,
        ok: false,
        error: 'モデルのロードがタイムアウトしました',
      }
    },
    [setCoachModelId, setCurrentRole],
  )

  // 1 モデルの実行を engine 別に分岐するヘルパ。
  // 戻り値: { loadMs, genMs, output, error }
  const runOneModel = useCallback(
    async (model, systemPrompt, userInput, onPhase) => {
      if (isLlamaRn(model)) {
        const t0 = Date.now()
        let llamaInitDone = 0
        let output = ''
        let error = null
        try {
          output = await runWithLlamaRnText({ model, modelContext: modelCtx }, async (llama) => {
            llamaInitDone = Date.now()
            onPhase?.('generating')
            // n_predict は role で切り替え (parser は短い JSON、coach は数文の応答)
            const nPredict = role === 'parser' ? 256 : 384
            const res = await llama.completion({
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userInput },
              ],
              jinja: true,
              n_predict: nPredict,
              temperature: role === 'parser' ? 0.2 : 0.5,
            })
            return (res?.text ?? res?.content ?? '').toString()
          })
        } catch (e) {
          error = e?.message ?? String(e)
        }
        const loadMs = llamaInitDone ? llamaInitDone - t0 : Date.now() - t0
        const genMs = llamaInitDone ? Date.now() - llamaInitDone : 0
        return { loadMs, genMs, output, error }
      }
      // executorch 経路
      onPhase?.('loading')
      const swap = await swapToExecutorchModel(model.id)
      if (!swap.ok) {
        return { loadMs: swap.loadMs, genMs: 0, output: '', error: swap.error }
      }
      onPhase?.('generating')
      const t1 = Date.now()
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput },
      ]
      let raw = ''
      let error = null
      try {
        raw = await llmRef.current.generate(messages)
      } catch (e) {
        error = e?.message ?? String(e)
      }
      const genMs = Date.now() - t1
      return {
        loadMs: swap.loadMs,
        genMs,
        output: typeof raw === 'string' ? raw : String(raw ?? ''),
        error,
      }
    },
    [role, swapToExecutorchModel, modelCtx],
  )

  const runBenchmark = useCallback(async () => {
    if (running) return
    if (!input.trim()) {
      Alert.alert('テスト入力が空です')
      return
    }
    if (selected.size === 0) {
      Alert.alert('対象モデルを 1 つ以上選択してください')
      return
    }
    if (llm.isGenerating) {
      Alert.alert('生成中です。少し待ってから実行してください')
      return
    }

    const allModels = [...LLM_MODELS, ...LLM_LLAMA_RN_TEXT_MODELS]
    const targets = allModels.filter((m) => selected.has(m.id))

    // 未 DL モデルが選ばれていれば警告して中断 (executorch / llama.rn どちらも)
    const missing = targets.filter((m) => !downloaded[m.id])
    if (missing.length > 0) {
      Alert.alert(
        'モデル未ダウンロード',
        `${missing.map((m) => m.label).join(', ')} がまだ DL されていません。先にダウンロードしてください。`,
      )
      return
    }

    const originalCoachId = coachModelIdRef.current
    const originalRole = currentRoleRef.current

    setRunning(true)
    setResults([])
    // ループ内で都度参照したいので、 state とは別にローカルでも保持
    const collected = []

    console.log('================================================================')
    console.log(`====== Benchmark START [role=${role}] ======`)
    console.log('[input]', input.trim())
    console.log('[targets]', targets.map((m) => `${m.label} (${isLlamaRn(m) ? 'llama.rn' : 'executorch'})`))

    try {
      // coach プロンプトは engine 非依存。 parser は engine ごとに few-shot が変わる
      // (executorch だけ短く、 llama.rn は多品目例つき) ので、 ループ内で都度組む。
      let coachPrompt = null
      if (role === 'coach') {
        const context = await buildCoachingContext()
        coachPrompt = buildCoachSystemPrompt(context)
        console.log('[systemPrompt length]', coachPrompt.length, 'chars')
      }

      for (let i = 0; i < targets.length; i++) {
        const m = targets[i]
        const engine = isLlamaRn(m) ? 'llama_rn' : 'executorch'
        const engineLabel = isLlamaRn(m) ? 'llama.rn' : 'executorch'
        setProgress({ i, total: targets.length, modelLabel: m.label, phase: 'loading' })
        console.log(`\n--- [${i + 1}/${targets.length}] ${m.label} (${engineLabel}) ---`)

        const systemPrompt = role === 'parser' ? buildParserSystemPrompt(engine) : coachPrompt
        if (role === 'parser') {
          console.log('[systemPrompt length]', systemPrompt.length, 'chars')
        }

        const r = await runOneModel(m, systemPrompt, input.trim(), (phase) => {
          setProgress({ i, total: targets.length, modelLabel: m.label, phase })
        })

        let parseResult = null
        if (role === 'parser' && r.output) {
          try {
            parseResult = parseRecordOutput(r.output)
          } catch (e) {
            parseResult = { error: e?.message ?? String(e) }
          }
        }

        const entry = {
          modelId: m.id,
          modelLabel: m.label,
          engine: engineLabel,
          loadMs: r.loadMs,
          genMs: r.genMs,
          output: r.output,
          parseResult,
          error: r.error,
        }
        collected.push(entry)
        setResults((prev) => [...prev, entry])

        // モデル完了ごとの詳細ログ
        console.log(`[load] ${r.loadMs}ms`)
        console.log(`[gen]  ${r.genMs}ms`)
        if (r.error) {
          console.log('[error]', r.error)
        } else {
          console.log('[output]')
          console.log(r.output || '(空応答)')
          if (parseResult) {
            if (parseResult.error) {
              console.log('[parse] NG:', parseResult.error)
            } else {
              const itemsInfo = parseResult.items ? ` items=${parseResult.items.length}` : ''
              console.log(`[parse] OK kind=${parseResult.kind}${itemsInfo}`)
              if (parseResult.items) {
                console.log('[items]', JSON.stringify(parseResult.items, null, 2))
              }
              if (parseResult.kind === 'weight') {
                console.log('[weight_kg]', parseResult.weight_kg)
              }
              if (parseResult.kind === 'activity') {
                console.log('[activity]', JSON.stringify({
                  activity_name: parseResult.activity_name,
                  duration_min: parseResult.duration_min,
                  distance_km: parseResult.distance_km,
                }))
              }
            }
          }
        }
      }

      // 最後にサマリテーブル風 (コピペしやすい等幅整形)
      console.log('\n====== Benchmark SUMMARY ======')
      const labelWidth = Math.max(...collected.map((r) => r.modelLabel.length), 20)
      const pad = (s, w) => String(s).padEnd(w)
      const padL = (s, w) => String(s).padStart(w)
      console.log(
        pad('model', labelWidth + 1) +
          pad('engine', 12) +
          padL('load(s)', 9) +
          padL('gen(s)', 9) +
          '  result',
      )
      console.log('-'.repeat(labelWidth + 1 + 12 + 9 + 9 + 2 + 20))
      for (const r of collected) {
        const status = r.error
          ? 'ERROR'
          : r.parseResult
          ? r.parseResult.error
            ? 'parse NG'
            : `parse OK (${r.parseResult.kind})`
          : 'ok'
        console.log(
          pad(r.modelLabel, labelWidth + 1) +
            pad(r.engine, 12) +
            padL((r.loadMs / 1000).toFixed(1), 9) +
            padL((r.genMs / 1000).toFixed(1), 9) +
            '  ' +
            status,
        )
      }
      console.log('================================================================')
    } catch (e) {
      console.warn('[benchmark] failed:', e?.message ?? e)
      Alert.alert('ベンチマーク失敗', e?.message ?? String(e))
    } finally {
      try {
        if (coachModelIdRef.current !== originalCoachId) {
          await setCoachModelId(originalCoachId)
        }
        if (currentRoleRef.current !== originalRole) {
          await setCurrentRole(originalRole)
        }
      } catch (e) {
        console.warn('[benchmark] restore failed:', e?.message ?? e)
      }
      setProgress(null)
      setRunning(false)
    }
  }, [running, input, selected, role, llm, downloaded, runOneModel, setCoachModelId, setCurrentRole])

  const renderExecutorchModelRow = (m) => {
    const isDownloaded = downloaded[m.id]
    const dlPct = downloadProgress[m.id]
    const downloading = dlPct != null
    const checked = selected.has(m.id)
    const canCheck = isDownloaded && !running
    return (
      <View key={m.id} style={[styles.modelRow, styles.modelRowLlama]}>
        <Pressable
          onPress={() => canCheck && toggleModel(m.id)}
          disabled={!canCheck}
          hitSlop={6}
        >
          <FontIcon
            name={checked ? 'check-square-o' : 'square-o'}
            size={20}
            color={canCheck ? colors.lightPurple : colors.gray}
          />
        </Pressable>
        <View style={styles.modelMain}>
          <View style={styles.modelLabelRow}>
            <Text style={styles.modelLabel}>{m.label}</Text>
            {m.badge && (
              <View style={styles.engineBadge}>
                <Text style={styles.engineBadgeText}>{m.badge}</Text>
              </View>
            )}
          </View>
          <Text style={styles.modelDesc} numberOfLines={2}>
            {m.description}
          </Text>
          {downloading && (
            <View style={styles.dlProgressWrap}>
              <View style={[styles.dlProgressBar, { width: `${Math.round(dlPct * 100)}%` }]} />
              <Text style={styles.dlProgressText}>{Math.round(dlPct * 100)}%</Text>
            </View>
          )}
        </View>
        <View style={styles.modelAction}>
          <Text style={styles.modelSize}>{m.approxSizeMb}MB</Text>
          {!isDownloaded && !downloading && (
            <TouchableOpacity
              onPress={() => onDownloadExecutorch(m)}
              disabled={running}
              style={[styles.dlBtn, running && styles.disabled]}
            >
              <FontIcon name="cloud-download" size={12} color={colors.white} />
              <Text style={styles.dlBtnText}>DL</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  const renderLlamaRnModelRow = (m) => {
    const isDownloaded = downloaded[m.id]
    const dlPct = downloadProgress[m.id]
    const downloading = dlPct != null
    const checked = selected.has(m.id)
    const sizeMb = Math.round((m.main?.sizeBytes ?? 0) / (1024 * 1024))
    return (
      <View key={m.id} style={[styles.modelRow, styles.modelRowLlama]}>
        <Pressable
          onPress={() => !running && isDownloaded && toggleModel(m.id)}
          disabled={running || !isDownloaded}
          hitSlop={6}
        >
          <FontIcon
            name={checked ? 'check-square-o' : 'square-o'}
            size={20}
            color={!isDownloaded || running ? colors.gray : colors.lightPurple}
          />
        </Pressable>
        <View style={styles.modelMain}>
          <View style={styles.modelLabelRow}>
            <Text style={styles.modelLabel}>{m.label}</Text>
            <View style={styles.engineBadge}>
              <Text style={styles.engineBadgeText}>{m.badge ?? 'GGUF'}</Text>
            </View>
          </View>
          <Text style={styles.modelDesc} numberOfLines={2}>
            {m.description}
          </Text>
          {downloading && (
            <View style={styles.dlProgressWrap}>
              <View style={[styles.dlProgressBar, { width: `${Math.round(dlPct * 100)}%` }]} />
              <Text style={styles.dlProgressText}>{Math.round(dlPct * 100)}%</Text>
            </View>
          )}
        </View>
        <View style={styles.modelAction}>
          <Text style={styles.modelSize}>{sizeMb}MB</Text>
          {!isDownloaded && !downloading && (
            <TouchableOpacity
              onPress={() => onDownloadLlamaRn(m)}
              disabled={running}
              style={[styles.dlBtn, running && styles.disabled]}
            >
              <FontIcon name="cloud-download" size={12} color={colors.white} />
              <Text style={styles.dlBtnText}>DL</Text>
            </TouchableOpacity>
          )}
          {isDownloaded && !downloading && (
            <TouchableOpacity
              onPress={() =>
                Alert.alert('削除', `${m.label} を削除しますか?`, [
                  { text: 'キャンセル', style: 'cancel' },
                  { text: '削除', style: 'destructive', onPress: () => onDeleteLlamaRn(m) },
                ])
              }
              disabled={running}
              style={[styles.delBtn, running && styles.disabled]}
            >
              <FontIcon name="trash-o" size={12} color={colors.darkPurple} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    )
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.root}>
        <Text style={styles.note}>
          同じ入力を選択したモデルに順番に投げて、出力と所要時間を比較します。
          実行中はチャット画面など LLM を使う画面は開かないでください (モデル swap が競合します)。
        </Text>

        <Text style={styles.sectionLabel}>役割</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            onPress={() => onPickRole('parser')}
            disabled={running}
            style={[styles.roleBtn, role === 'parser' && styles.roleBtnActive, running && styles.disabled]}
          >
            <Text style={[styles.roleBtnText, role === 'parser' && styles.roleBtnTextActive]}>
              parser (記録)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onPickRole('coach')}
            disabled={running}
            style={[styles.roleBtn, role === 'coach' && styles.roleBtnActive, running && styles.disabled]}
          >
            <Text style={[styles.roleBtnText, role === 'coach' && styles.roleBtnTextActive]}>
              coach (コーチ)
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionLabel}>テスト入力</Text>
        <View style={styles.presetRow}>
          {PRESETS[role].map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => onPickPreset(p)}
              disabled={running}
              style={[styles.presetChip, input === p && styles.presetChipActive, running && styles.disabled]}
            >
              <Text style={[styles.presetText, input === p && styles.presetTextActive]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput
          multiline
          value={input}
          onChangeText={setInput}
          editable={!running}
          style={styles.textArea}
          placeholder="入力テキスト"
          placeholderTextColor={colors.gray}
        />

        <Text style={styles.sectionLabel}>対象モデル (executorch)</Text>
        <View style={styles.modelList}>
          {LLM_MODELS.map(renderExecutorchModelRow)}
        </View>

        <Text style={styles.sectionLabel}>対象モデル (llama.rn / GGUF)</Text>
        <Text style={styles.sectionHint}>
          executorch に .pte が無いモデル (日本語特化版など) を試すための追加経路。
          初回は DL ボタンでダウンロードしてください (Wi-Fi 推奨)。
        </Text>
        <View style={styles.modelList}>
          {LLM_LLAMA_RN_TEXT_MODELS.map(renderLlamaRnModelRow)}
        </View>

        <TouchableOpacity
          onPress={runBenchmark}
          disabled={running || selected.size === 0}
          style={[
            styles.runBtn,
            (running || selected.size === 0) && styles.runBtnDisabled,
          ]}
          activeOpacity={0.8}
        >
          {running ? (
            <View style={styles.runBtnRow}>
              <ActivityIndicator size="small" color={colors.white} />
              <Text style={styles.runBtnText}>
                {progress
                  ? `${progress.i + 1}/${progress.total} ${progress.modelLabel} (${
                      progress.phase === 'loading' ? '読み込み中' : '推論中'
                    })`
                  : '実行中…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.runBtnText}>実行</Text>
          )}
        </TouchableOpacity>

        {results.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>結果</Text>
            {results.map((r, idx) => (
              <View key={`${r.modelId}-${idx}`} style={styles.resultCard}>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultModel}>
                    {r.modelLabel}{' '}
                    <Text style={styles.resultEngine}>({r.engine})</Text>
                  </Text>
                  <Text style={styles.resultMeta}>
                    {r.loadMs != null ? `load ${(r.loadMs / 1000).toFixed(1)}s` : ''}
                    {r.genMs != null ? ` / gen ${(r.genMs / 1000).toFixed(1)}s` : ''}
                  </Text>
                </View>
                {r.error ? (
                  <Text style={styles.resultError}>エラー: {r.error}</Text>
                ) : (
                  <>
                    <Text style={styles.resultOutput} selectable>
                      {r.output || '(空応答)'}
                    </Text>
                    {r.parseResult && (
                      <Text
                        style={
                          r.parseResult.error ? styles.resultParseNg : styles.resultParseOk
                        }
                      >
                        {r.parseResult.error
                          ? `パース失敗: ${r.parseResult.error}`
                          : `パース成功: kind=${r.parseResult.kind}${
                              r.parseResult.items
                                ? ` / items=${r.parseResult.items.length}`
                                : ''
                            }`}
                      </Text>
                    )}
                  </>
                )}
              </View>
            ))}
          </View>
        )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: { padding: 16, paddingBottom: 60 },
  note: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 16,
    lineHeight: 18,
  },
  sectionLabel: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 8,
    lineHeight: 17,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e5e2f0',
    alignItems: 'center',
  },
  roleBtnActive: {
    backgroundColor: colors.lightPurple,
  },
  roleBtnText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  roleBtnTextActive: {
    color: colors.white,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#dcd9ec',
  },
  presetChipActive: {
    backgroundColor: '#efedf7',
    borderColor: colors.lightPurple,
  },
  presetText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
  },
  presetTextActive: {
    fontWeight: '700',
  },
  textArea: {
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: fontSize.middle,
    color: colors.black,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modelList: {
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingHorizontal: 4,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0eef7',
  },
  modelRowLlama: {
    alignItems: 'flex-start',
  },
  modelRowPressed: {
    backgroundColor: '#f4f3fb',
  },
  modelMain: {
    flex: 1,
    marginLeft: 10,
  },
  modelLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelLabel: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  modelDesc: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 2,
  },
  modelSize: {
    fontSize: fontSize.small,
    color: colors.gray,
  },
  modelAction: {
    alignItems: 'flex-end',
    gap: 6,
    minWidth: 60,
  },
  engineBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: '#efedf7',
  },
  engineBadgeText: {
    fontSize: 10,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  dlProgressWrap: {
    marginTop: 6,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#efedf7',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  dlProgressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.lightPurple,
  },
  dlProgressText: {
    fontSize: 10,
    color: colors.darkPurple,
    fontWeight: '700',
    alignSelf: 'center',
  },
  dlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: colors.lightPurple,
  },
  dlBtnText: {
    fontSize: 11,
    color: colors.white,
    fontWeight: '700',
  },
  delBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  runBtn: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: colors.lightPurple,
    alignItems: 'center',
  },
  runBtnDisabled: {
    backgroundColor: '#bdb6d8',
  },
  runBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  runBtnText: {
    color: colors.white,
    fontSize: fontSize.middle,
    fontWeight: '700',
  },
  resultCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e2f0',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  resultModel: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  resultEngine: {
    fontSize: fontSize.small,
    color: colors.gray,
    fontWeight: '400',
  },
  resultMeta: {
    fontSize: fontSize.small,
    color: colors.gray,
  },
  resultOutput: {
    fontSize: fontSize.small,
    color: colors.black,
    fontFamily: 'Courier',
    backgroundColor: '#f4f3fb',
    padding: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  resultParseOk: {
    fontSize: fontSize.small,
    color: '#2a8a3a',
    marginTop: 6,
    fontWeight: '600',
  },
  resultParseNg: {
    fontSize: fontSize.small,
    color: colors.redPrimary,
    marginTop: 6,
    fontWeight: '600',
  },
  resultError: {
    fontSize: fontSize.small,
    color: colors.redPrimary,
    marginTop: 4,
  },
  disabled: {
    opacity: 0.5,
  },
})
