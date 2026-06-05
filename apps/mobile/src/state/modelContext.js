import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLLM } from 'react-native-executorch'
import { DEFAULT_MODEL_ID, LLM_MODELS, getModelById } from '../data/llmModels'

// 「記録用 (parser)」と「コーチ用 (coach)」で別々のモデルを使う設計。
//   - parser (記録用): 構造化出力。軽量モデルで十分（速度優先）
//   - coach (コーチ用): 自然言語応答。重めのモデルで品質を出す
// 両方を同時に常駐させると低 RAM 端末で破綻するため、useLLM は 1 つだけ持ち、
// currentRole に応じて parser/coach のモデルを差し替える（swap 方式）。
// 結果、モード切替時に数秒〜数十秒のロード時間が発生する代わりに RAM 消費は片方分だけ。

const PARSER_KEY = '@priveat/active-parser-model-id'
const COACH_KEY = '@priveat/active-coach-model-id'
// 「現在ロード中（未完了）」の {role, modelId} を JSON で記録。
// 起動時にこの値が残っていれば「前回のロードが完了せず終了した（OOM クラッシュ等）」
// と判定し、該当ロールのみデフォルトに戻して fallback フラグを立てる。
const PENDING_LOAD_KEY = '@priveat/pending-model-load-v2'

const DEFAULT_PARSER_MODEL_ID = 'qwen3-0.6b-q'
const DEFAULT_COACH_MODEL_ID = 'qwen3-1.7b-q'

const isValidId = (id) => id && LLM_MODELS.some((m) => m.id === id)

const ROLES = ['parser', 'coach']

// ---- Model 選択ステート用 Context -----------------------------------------
const ModelContext = createContext({
  parserModelId: DEFAULT_PARSER_MODEL_ID,
  coachModelId: DEFAULT_COACH_MODEL_ID,
  parserModel: getModelById(DEFAULT_PARSER_MODEL_ID),
  coachModel: getModelById(DEFAULT_COACH_MODEL_ID),
  currentRole: 'parser',
  // activeModel / activeModelId は「いま LLMProvider がロードしようとしているモデル」。
  // currentRole に追従する。後方互換のため残す（既存コードが activeModel を参照していたため）。
  activeModelId: DEFAULT_PARSER_MODEL_ID,
  activeModel: getModelById(DEFAULT_PARSER_MODEL_ID),
  setParserModelId: () => {},
  setCoachModelId: () => {},
  setCurrentRole: () => {},
  markLoaded: () => {},
  fellBack: null, // null | { role, fromId }
  dismissFellBack: () => {},
  isLoaded: false,
})

// ---- LLM インスタンス用 Context -------------------------------------------
// 購読者は Chat 画面と ModelScreen のみ。Provider 配下でも useActiveLLM() を呼ばない
// 画面は llm の状態変化（messageHistory 更新など）でリレンダリングされない。
const LLMContext = createContext(null)

export const ModelProvider = ({ children }) => {
  const [parserModelId, setParserModelIdState] = useState(DEFAULT_PARSER_MODEL_ID)
  const [coachModelId, setCoachModelIdState] = useState(DEFAULT_COACH_MODEL_ID)
  const [currentRole, setCurrentRoleState] = useState('parser')
  const [isLoaded, setIsLoaded] = useState(false)
  const [fellBack, setFellBack] = useState(null)

  // AsyncStorage から初期値を読み込み + 前回クラッシュ検出
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [storedParser, storedCoach, pendingRaw] = await Promise.all([
          AsyncStorage.getItem(PARSER_KEY),
          AsyncStorage.getItem(COACH_KEY),
          AsyncStorage.getItem(PENDING_LOAD_KEY),
        ])

        let nextParserId = isValidId(storedParser) ? storedParser : DEFAULT_PARSER_MODEL_ID
        let nextCoachId = isValidId(storedCoach) ? storedCoach : DEFAULT_COACH_MODEL_ID

        // pending 検出: 前回ロード未完了の role を default に戻す。
        // ただし fallback 後にデフォルトを再 pending するのを避けるため、
        // 「pending の modelId が default と同じ」場合は fallback しない。
        let fb = null
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw)
            if (pending && ROLES.includes(pending.role) && isValidId(pending.modelId)) {
              const defaultFor =
                pending.role === 'coach' ? DEFAULT_COACH_MODEL_ID : DEFAULT_PARSER_MODEL_ID
              if (pending.modelId !== defaultFor) {
                console.warn(
                  '[modelContext] previous load incomplete:',
                  pending.role,
                  pending.modelId,
                  '→ fallback to',
                  defaultFor,
                )
                if (pending.role === 'parser') nextParserId = defaultFor
                else nextCoachId = defaultFor
                fb = { role: pending.role, fromId: pending.modelId }
                // ストレージにも反映
                await AsyncStorage.setItem(
                  pending.role === 'parser' ? PARSER_KEY : COACH_KEY,
                  defaultFor,
                )
              }
            }
          } catch (e) {
            // pending JSON が壊れていたら無視
          }
        }

        // 起動時にロードするのは currentRole = 'parser' なので、その pending を記録
        await AsyncStorage.setItem(
          PENDING_LOAD_KEY,
          JSON.stringify({ role: 'parser', modelId: nextParserId }),
        )

        if (cancelled) return
        setParserModelIdState(nextParserId)
        setCoachModelIdState(nextCoachId)
        setFellBack(fb)
      } catch (e) {
        console.warn('[modelContext] load failed:', e)
      } finally {
        if (!cancelled) setIsLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const setParserModelId = useCallback(
    async (id) => {
      if (!isValidId(id)) return
      setParserModelIdState(id)
      try {
        await AsyncStorage.setItem(PARSER_KEY, id)
        // currentRole が parser なら次にロードされる → pending 記録更新
        if (currentRole === 'parser') {
          await AsyncStorage.setItem(
            PENDING_LOAD_KEY,
            JSON.stringify({ role: 'parser', modelId: id }),
          )
        }
      } catch (e) {
        console.warn('[modelContext] save parser failed:', e)
      }
    },
    [currentRole],
  )

  const setCoachModelId = useCallback(
    async (id) => {
      if (!isValidId(id)) return
      setCoachModelIdState(id)
      try {
        await AsyncStorage.setItem(COACH_KEY, id)
        if (currentRole === 'coach') {
          await AsyncStorage.setItem(
            PENDING_LOAD_KEY,
            JSON.stringify({ role: 'coach', modelId: id }),
          )
        }
      } catch (e) {
        console.warn('[modelContext] save coach failed:', e)
      }
    },
    [currentRole],
  )

  // ロール切替: LLMProvider が新しいモデルを swap でロードする。
  const setCurrentRole = useCallback(
    async (role) => {
      if (!ROLES.includes(role) || role === currentRole) return
      setCurrentRoleState(role)
      try {
        const nextId = role === 'coach' ? coachModelId : parserModelId
        await AsyncStorage.setItem(
          PENDING_LOAD_KEY,
          JSON.stringify({ role, modelId: nextId }),
        )
      } catch (e) {
        // ignore
      }
    },
    [currentRole, parserModelId, coachModelId],
  )

  // llm.isReady で LLMProvider が呼ぶ: pending フラグを消す = 正常にロード完了
  const markLoaded = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(PENDING_LOAD_KEY)
    } catch (e) {
      /* ignore */
    }
  }, [])

  const dismissFellBack = useCallback(() => setFellBack(null), [])

  const activeModelId = currentRole === 'coach' ? coachModelId : parserModelId
  const activeModel = getModelById(activeModelId)

  const value = useMemo(
    () => ({
      parserModelId,
      coachModelId,
      parserModel: getModelById(parserModelId),
      coachModel: getModelById(coachModelId),
      currentRole,
      activeModelId,
      activeModel,
      setParserModelId,
      setCoachModelId,
      setCurrentRole,
      markLoaded,
      fellBack,
      dismissFellBack,
      isLoaded,
    }),
    [
      parserModelId,
      coachModelId,
      currentRole,
      activeModelId,
      activeModel,
      setParserModelId,
      setCoachModelId,
      setCurrentRole,
      markLoaded,
      fellBack,
      dismissFellBack,
      isLoaded,
    ],
  )

  return (
    <ModelContext.Provider value={value}>
      <LLMProvider>{children}</LLMProvider>
    </ModelContext.Provider>
  )
}

// LLMProvider は ModelProvider の内側で動く。activeModel.source が変わると
// useLLM が新しいモデルで再初期化される（hot-swap / role swap 共通の経路）。
//   - 起動時は parser モデルをロード
//   - currentRole が 'coach' に変わると coach モデルへ swap
//   - markLoaded は llm.isReady になったタイミングで Provider 側で自動呼び出し
//   - llm インスタンスは LLMContext で配るので、購読していない画面は rerender されない
const LLMProvider = ({ children }) => {
  const { activeModel, markLoaded } = useContext(ModelContext)
  const llm = useLLM({ model: activeModel.source })

  useEffect(() => {
    if (llm.isReady) markLoaded()
  }, [llm.isReady, markLoaded])

  return <LLMContext.Provider value={llm}>{children}</LLMContext.Provider>
}

export const useActiveModel = () => useContext(ModelContext)

// LLM インスタンスを購読するためのフック。Chat / ModelScreen が呼ぶ。
// Provider 外で呼ぶと null が返る。
export const useActiveLLM = () => useContext(LLMContext)

export { DEFAULT_PARSER_MODEL_ID, DEFAULT_COACH_MODEL_ID }
// 後方互換: 旧コードが import している可能性のためエクスポートしておく
export { DEFAULT_MODEL_ID }
