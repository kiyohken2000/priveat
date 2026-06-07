import { useCallback, useEffect, useRef, useState } from 'react'
import { initLlama } from 'llama.rn'
import {
  downloadLlamaRnTextModel,
  getLlamaRnTextModelPaths,
  isLlamaRnTextModelDownloaded,
} from '../services/llmTextModelStorage'

// react-native-executorch の `useLLM` と同じシェイプを露出する llama.rn 経路のフック。
//
// 目的:
//   - Chat.js / coaching/advice.js / utils/aiKcal.js は executorch の `useLLM` を前提に
//     書かれている (isReady/isGenerating/messageHistory/configure/sendMessage/generate/interrupt)。
//   - 同じ shape を露出することで、 LLMProvider 側で engine スイッチするだけで下流が無変更で動く。
//
// 露出する API (executorch useLLM 準拠):
//   - messageHistory: Message[] — system + 会話ログ
//   - response: string — 生成途中のテキスト (streaming トークン callback で更新)
//   - token: string — 直近トークン (互換用、空のままでも下流は読まない)
//   - isReady: boolean
//   - isGenerating: boolean
//   - downloadProgress: number — 0..1 (初回 DL 進捗)
//   - error: Error | null
//   - configure({ chatConfig, generationConfig }) — systemPrompt / initialMessageHistory / temperature 等
//   - sendMessage(text) — user 行追加 → completion → assistant 行追加。 generation 中は no-op
//   - generate(messages) — ワンショット推論。 messageHistory に触らない (advice.js / aiKcal.js 用)
//   - interrupt() — stopCompletion で生成中断
//   - getGeneratedTokenCount / getTotalTokenCount / getPromptTokenCount — 直近 completion の usage
//   - deleteMessage(index) — index 以降を切り捨てて再生成可能に
//
// preventLoad:
//   - VLM/排他制御 (vlmOrchestrator 経由) で executorch をアンロードする経路と対称。
//   - 二重化された LLMProvider で「非アクティブ側エンジン」を unload するためのフラグ。
//   - true → 既存 llama context を release し、 isReady=false に戻す
//   - false → 自動再ロード

const DEFAULT_N_CTX = 4096
const DEFAULT_N_GPU_LAYERS = 99 // iOS Metal フル (CPU only にしたい場合は 0)

// engine スイッチ時に executorch (useLLM) の cleanup が Metal Working Set を解放するのを
// 待つためのインターバル。 vlmOrchestrator の SETTLE_MS と同等。 これを挟まないと iOS で
// 「executorch がまだ解放中の Metal メモリ」 + 「llama.rn が確保する Metal メモリ」が
// 一瞬重なってロード失敗する可能性がある。
const SETTLE_MS = 400

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const DEFAULT_GENERATION = {
  temperature: 0.7,
  topP: 0.95,
  nPredict: 512,
}

const buildBaseHistory = (systemPrompt, initialHistory) => {
  const base = []
  if (systemPrompt) base.push({ role: 'system', content: systemPrompt })
  for (const m of initialHistory) base.push(m)
  return base
}

export function useLlamaRnLLM({ model, preventLoad = false } = {}) {
  const [messageHistory, setMessageHistory] = useState([])
  const [response, setResponse] = useState('')
  const [token, setToken] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [error, setError] = useState(null)

  // ---- refs -----------------------------------------------------------------
  // llama.rn インスタンス。 release/init のレースを避けるため ref で持つ。
  const llamaRef = useRef(null)
  // setMessageHistory と同期した最新履歴。 sendMessage 内で「直前の状態」を読むのに使う。
  const messageHistoryRef = useRef([])
  // configure 経由で設定される。 init 完了時 / clear 時に履歴に再投入する。
  const systemPromptRef = useRef('')
  const initialHistoryRef = useRef([])
  const generationConfigRef = useRef({ ...DEFAULT_GENERATION })
  // interrupt フラグ。 stopCompletion 後の戻り値を捨てるためのマーカー。
  const interruptedRef = useRef(false)
  // 直近 completion の usage (token 数取得用)。
  const lastUsageRef = useRef({
    promptTokens: 0,
    generatedTokens: 0,
  })

  const setHistory = useCallback((next) => {
    messageHistoryRef.current = next
    setMessageHistory(next)
  }, [])

  // ---- init / teardown ------------------------------------------------------
  const modelKey = model?.id ?? null

  useEffect(() => {
    let cancelled = false

    // preventLoad=true もしくは model なし → 既存 ctx 解放
    if (!model || preventLoad) {
      const cur = llamaRef.current
      llamaRef.current = null
      setIsReady(false)
      if (cur) {
        cur.release().catch((e) => {
          console.warn('[useLlamaRnLLM] release on teardown failed:', e?.message ?? e)
        })
      }
      return () => {
        cancelled = true
      }
    }

    setIsReady(false)
    setError(null)
    setDownloadProgress(0)

    ;(async () => {
      try {
        // 0) 他エンジンの cleanup を待つ。 useLLM の preventLoad=true により executorch が
        //    解放されるが、 Metal メモリの実解放は async。 init 前に短く待って衝突回避。
        await sleep(SETTLE_MS)
        if (cancelled) return

        // 1) DL (未保存なら) — 初回のみ進捗 UI を出す
        const alreadyDownloaded = await isLlamaRnTextModelDownloaded(model)
        if (!alreadyDownloaded) {
          await downloadLlamaRnTextModel(model, (pct) => {
            if (!cancelled) setDownloadProgress(typeof pct === 'number' ? pct : 0)
          })
        } else {
          setDownloadProgress(1)
        }
        if (cancelled) return

        // 2) llama.rn 初期化
        const { mainPath } = getLlamaRnTextModelPaths(model)
        const llama = await initLlama({
          model: mainPath,
          n_ctx: DEFAULT_N_CTX,
          n_gpu_layers: DEFAULT_N_GPU_LAYERS,
        })

        if (cancelled) {
          llama.release().catch(() => {})
          return
        }
        llamaRef.current = llama

        // 3) configure 済みの system + initial history を再投入
        setHistory(buildBaseHistory(systemPromptRef.current, initialHistoryRef.current))
        setIsReady(true)
      } catch (e) {
        if (!cancelled) {
          console.warn('[useLlamaRnLLM] init failed:', e?.message ?? e)
          setError(e instanceof Error ? e : new Error(String(e)))
          setIsReady(false)
        }
      }
    })()

    return () => {
      cancelled = true
      const cur = llamaRef.current
      llamaRef.current = null
      setIsReady(false)
      if (cur) {
        cur.release().catch((e) => {
          console.warn('[useLlamaRnLLM] release on cleanup failed:', e?.message ?? e)
        })
      }
    }
    // model.id 変化 or preventLoad の切替で再 init
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, preventLoad])

  // ---- configure ------------------------------------------------------------
  const configure = useCallback(
    ({ chatConfig, generationConfig } = {}) => {
      let touchedHistory = false
      if (chatConfig?.systemPrompt !== undefined) {
        systemPromptRef.current = chatConfig.systemPrompt ?? ''
        touchedHistory = true
      }
      if (chatConfig?.initialMessageHistory !== undefined) {
        initialHistoryRef.current = Array.isArray(chatConfig.initialMessageHistory)
          ? chatConfig.initialMessageHistory
          : []
        touchedHistory = true
      }
      if (generationConfig) {
        // executorch と同じく、 指定された key だけ上書き (他は維持)
        const next = { ...generationConfigRef.current }
        if (generationConfig.temperature !== undefined) next.temperature = generationConfig.temperature
        if (generationConfig.topP !== undefined) next.topP = generationConfig.topP
        if (generationConfig.topp !== undefined) next.topP = generationConfig.topp
        if (generationConfig.repetitionPenalty !== undefined) {
          next.repetitionPenalty = generationConfig.repetitionPenalty
        }
        // n_predict は executorch にはない概念だが、 受け入れておく
        if (generationConfig.nPredict !== undefined) next.nPredict = generationConfig.nPredict
        generationConfigRef.current = next
      }
      if (touchedHistory) {
        setHistory(buildBaseHistory(systemPromptRef.current, initialHistoryRef.current))
      }
      // LFM2 系は recurrent state を持つので configure (= 新しい会話開始) のタイミングで
      // KV cache を必ずクリアする。 clearCache(false) は metadata のみで軽い。
      const llama = llamaRef.current
      if (llama) {
        llama.clearCache(false).catch((e) => {
          // 一部バージョンで未実装なら無視
          console.warn('[useLlamaRnLLM] clearCache failed:', e?.message ?? e)
        })
      }
    },
    [setHistory],
  )

  // ---- 共通 completion 呼び出し ---------------------------------------------
  const runCompletion = useCallback(async (messages) => {
    const llama = llamaRef.current
    if (!llama) throw new Error('llama.rn コンテキストが未初期化です')
    const gen = generationConfigRef.current
    interruptedRef.current = false
    setResponse('')
    setToken('')

    const res = await llama.completion(
      {
        messages,
        jinja: true,
        n_predict: gen.nPredict ?? DEFAULT_GENERATION.nPredict,
        temperature: gen.temperature ?? DEFAULT_GENERATION.temperature,
        top_p: gen.topP ?? DEFAULT_GENERATION.topP,
        // repetitionPenalty は llama.rn では penalty_repeat
        ...(gen.repetitionPenalty != null ? { penalty_repeat: gen.repetitionPenalty } : {}),
      },
      (data) => {
        // streaming トークン: response を逐次伸ばす
        if (data?.token) {
          setToken(data.token)
          setResponse((prev) => prev + data.token)
        }
      },
    )

    lastUsageRef.current = {
      promptTokens: res?.tokens_evaluated ?? 0,
      generatedTokens: res?.tokens_predicted ?? 0,
    }
    const text = (res?.content ?? res?.text ?? '').toString()
    return { text, interrupted: !!res?.interrupted || interruptedRef.current }
  }, [])

  // ---- sendMessage ----------------------------------------------------------
  const sendMessage = useCallback(
    async (text) => {
      if (!llamaRef.current || isGenerating) return ''
      const userMessage = { role: 'user', content: text }
      const nextHistory = [...messageHistoryRef.current, userMessage]
      setHistory(nextHistory)
      setIsGenerating(true)
      try {
        const { text: assistantText, interrupted } = await runCompletion(nextHistory)
        if (interrupted) {
          // 中断時は assistant 行を追加しない (executorch の挙動に近い)
          return ''
        }
        setHistory([...nextHistory, { role: 'assistant', content: assistantText }])
        return assistantText
      } catch (e) {
        console.warn('[useLlamaRnLLM] sendMessage failed:', e?.message ?? e)
        setError(e instanceof Error ? e : new Error(String(e)))
        return ''
      } finally {
        setIsGenerating(false)
      }
    },
    [isGenerating, runCompletion, setHistory],
  )

  // ---- generate (ワンショット) -----------------------------------------------
  const generate = useCallback(
    async (messages) => {
      if (!llamaRef.current) throw new Error('AI モデルが準備できていません')
      if (isGenerating) throw new Error('別の生成が進行中です')
      setIsGenerating(true)
      try {
        const { text } = await runCompletion(messages)
        return text
      } finally {
        setIsGenerating(false)
      }
    },
    [isGenerating, runCompletion],
  )

  // ---- interrupt ------------------------------------------------------------
  const interrupt = useCallback(() => {
    interruptedRef.current = true
    const llama = llamaRef.current
    if (llama) {
      llama.stopCompletion().catch((e) => {
        console.warn('[useLlamaRnLLM] stopCompletion failed:', e?.message ?? e)
      })
    }
  }, [])

  // ---- token count getters (executorch 互換、 直近 completion ベース) --------
  const getGeneratedTokenCount = useCallback(() => lastUsageRef.current.generatedTokens, [])
  const getPromptTokenCount = useCallback(() => lastUsageRef.current.promptTokens, [])
  const getTotalTokenCount = useCallback(
    () => lastUsageRef.current.promptTokens + lastUsageRef.current.generatedTokens,
    [],
  )

  // ---- deleteMessage --------------------------------------------------------
  const deleteMessage = useCallback(
    (index) => {
      if (typeof index !== 'number' || index < 0) return
      const cur = messageHistoryRef.current
      if (index >= cur.length) return
      const next = cur.slice(0, index)
      setHistory(next)
    },
    [setHistory],
  )

  return {
    messageHistory,
    response,
    token,
    isReady,
    isGenerating,
    downloadProgress,
    error,
    configure,
    sendMessage,
    generate,
    interrupt,
    getGeneratedTokenCount,
    getPromptTokenCount,
    getTotalTokenCount,
    deleteMessage,
  }
}
