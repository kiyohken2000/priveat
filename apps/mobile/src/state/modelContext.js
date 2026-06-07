import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLLM } from 'react-native-executorch'
import { DEFAULT_MODEL_ID, LLM_MODELS, getModelById as getExecutorchModelById } from '../data/llmModels'
import { DEFAULT_VLM_MODEL_ID, VLM_MODELS } from '../data/llmModelsVlm'
import { LLM_LLAMA_RN_TEXT_MODELS, getLlamaRnTextModelById } from '../data/llmTextModelsLlamaRn'
import { useLlamaRnLLM } from './useLlamaRnLLM'

// 「記録用 (parser)」「コーチ用 (coach)」で別々のモデルを使う設計。
//   - parser (記録用): 構造化出力。軽量モデルで十分（速度優先）
//   - coach  (コーチ用): 自然言語応答。重めのモデルで品質を出す
// 各ロールに対して 2 つのエンジンが選べる:
//   - executorch (useLLM): .pte 形式、 既定の経路 (Qwen3 / LFM2.5 多言語 / Qwen3.5)
//   - llama.rn   (useLlamaRnLLM): GGUF 形式、 LFM2.5-1.2B-JP 等の日本語特化モデル
// engine は model.id から導出する (両カタログを横断検索)。 ID は両カタログで一意。
//
// 同時常駐する RAM が厳しいので 1 つの role には 1 つだけロード。
// 加えて非アクティブの engine の hook も常に呼びつつ preventLoad=true で解放、
// React のフックルールを守りつつメモリ占有はゼロに保つ。
//
// 写真認識 (VLM) は llama.rn 経由で別エンジン管理 (vlmOrchestrator)。
// 時間軸で排他制御し (preventLlmLoad=true で executorch & llama.rn テキスト両方を解放)、
// 同時並行ロードは避ける。

const PARSER_KEY = '@priveat/active-parser-model-id'
const COACH_KEY = '@priveat/active-coach-model-id'
// llama.rn 経由の VLM 設定。executorch の parser/coach とは独立。
// 切替方針の経緯は docs/PLAN_VLM_llama_rn.md を参照。
const VLM_ENABLED_KEY = '@priveat/vlm-enabled'
const VLM_MODEL_KEY = '@priveat/vlm-model-id'
// 「現在ロード中（未完了）」の {role, modelId} を JSON で記録。
// 起動時にこの値が残っていれば「前回のロードが完了せず終了した（OOM クラッシュ等）」
// と判定し、該当ロールのみデフォルトに戻して fallback フラグを立てる。
const PENDING_LOAD_KEY = '@priveat/pending-model-load-v2'

const DEFAULT_PARSER_MODEL_ID = 'qwen3-0.6b-q'
const DEFAULT_COACH_MODEL_ID = 'qwen3-1.7b-q'

// model.id は両カタログを跨いで一意の前提。
const isValidId = (id) =>
  !!id &&
  (LLM_MODELS.some((m) => m.id === id) || LLM_LLAMA_RN_TEXT_MODELS.some((m) => m.id === id))
const isValidVlmId = (id) => id && VLM_MODELS.some((m) => m.id === id)

// engine 横断 lookup。 戻り値に engine フィールドを足して返す。
// id が両カタログに見当たらない場合は executorch のデフォルト (qwen3-0.6b-q) にフォールバック。
const getAnyModelById = (id) => {
  const lr = getLlamaRnTextModelById(id)
  if (lr) return { ...lr, engine: 'llama_rn' }
  const ex = getExecutorchModelById(id)
  return { ...ex, engine: 'executorch' }
}

const getEngineFor = (id) =>
  LLM_LLAMA_RN_TEXT_MODELS.some((m) => m.id === id) ? 'llama_rn' : 'executorch'

const ROLES = ['parser', 'coach']

const STORAGE_KEY_BY_ROLE = {
  parser: PARSER_KEY,
  coach: COACH_KEY,
}
const DEFAULT_BY_ROLE = {
  parser: DEFAULT_PARSER_MODEL_ID,
  coach: DEFAULT_COACH_MODEL_ID,
}

// ---- Model 選択ステート用 Context -----------------------------------------
const ModelContext = createContext({
  parserModelId: DEFAULT_PARSER_MODEL_ID,
  coachModelId: DEFAULT_COACH_MODEL_ID,
  parserModel: getAnyModelById(DEFAULT_PARSER_MODEL_ID),
  coachModel: getAnyModelById(DEFAULT_COACH_MODEL_ID),
  parserEngine: 'executorch',
  coachEngine: 'executorch',
  currentRole: 'parser',
  // activeModel / activeModelId は「いま LLMProvider がロードしようとしているモデル」。
  // currentRole に追従する。後方互換のため残す（既存コードが activeModel を参照していたため）。
  activeModelId: DEFAULT_PARSER_MODEL_ID,
  activeModel: getAnyModelById(DEFAULT_PARSER_MODEL_ID),
  activeEngine: 'executorch',
  setParserModelId: () => {},
  setCoachModelId: () => {},
  setCurrentRole: () => {},
  markLoaded: () => {},
  fellBack: null, // null | { role, fromId }
  dismissFellBack: () => {},
  isLoaded: false,
  // ---- llama.rn 経由の VLM 設定 (executorch とは独立、orchestrator 経由でのみ起動) ----
  vlmEnabled: false,
  vlmModelId: DEFAULT_VLM_MODEL_ID,
  setVlmEnabled: () => {},
  setVlmModelId: () => {},
  preventLlmLoad: false,
  setPreventLlmLoad: () => {},
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
  // llama.rn 経由の VLM 設定。常駐 LLM ではないので Provider への影響なし。
  const [vlmEnabled, setVlmEnabledState] = useState(false)
  const [vlmModelId, setVlmModelIdState] = useState(DEFAULT_VLM_MODEL_ID)
  // VLM orchestrator から制御される: true の間は executorch (useLLM) をアンロードして
  // llama.rn に GPU メモリを譲る。orchestrator が終了時に自動で false に戻す。
  const [preventLlmLoad, setPreventLlmLoadState] = useState(false)

  // AsyncStorage から初期値を読み込み + 前回クラッシュ検出
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [
          storedParser,
          storedCoach,
          pendingRaw,
          storedVlmEnabled,
          storedVlmModel,
        ] = await Promise.all([
          AsyncStorage.getItem(PARSER_KEY),
          AsyncStorage.getItem(COACH_KEY),
          AsyncStorage.getItem(PENDING_LOAD_KEY),
          AsyncStorage.getItem(VLM_ENABLED_KEY),
          AsyncStorage.getItem(VLM_MODEL_KEY),
        ])

        let nextParserId = isValidId(storedParser) ? storedParser : DEFAULT_PARSER_MODEL_ID
        let nextCoachId = isValidId(storedCoach) ? storedCoach : DEFAULT_COACH_MODEL_ID
        const nextVlmEnabled = storedVlmEnabled === '1'
        const nextVlmModelId = isValidVlmId(storedVlmModel) ? storedVlmModel : DEFAULT_VLM_MODEL_ID

        // pending 検出: 前回ロード未完了の role を default に戻す。
        // ただし fallback 後にデフォルトを再 pending するのを避けるため、
        // 「pending の modelId が default と同じ」場合は fallback しない。
        let fb = null
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw)
            if (pending && ROLES.includes(pending.role) && isValidId(pending.modelId)) {
              const defaultFor = DEFAULT_BY_ROLE[pending.role]
              if (pending.modelId !== defaultFor) {
                console.warn(
                  '[modelContext] previous load incomplete:',
                  pending.role,
                  pending.modelId,
                  '→ fallback to',
                  defaultFor,
                )
                if (pending.role === 'parser') nextParserId = defaultFor
                else if (pending.role === 'coach') nextCoachId = defaultFor
                fb = { role: pending.role, fromId: pending.modelId }
                // ストレージにも反映
                await AsyncStorage.setItem(STORAGE_KEY_BY_ROLE[pending.role], defaultFor)
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
        setVlmEnabledState(nextVlmEnabled)
        setVlmModelIdState(nextVlmModelId)
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

  const setVlmEnabled = useCallback(async (next) => {
    const b = !!next
    setVlmEnabledState(b)
    try {
      await AsyncStorage.setItem(VLM_ENABLED_KEY, b ? '1' : '0')
    } catch (e) {
      console.warn('[modelContext] save vlmEnabled failed:', e)
    }
  }, [])

  const setVlmModelId = useCallback(async (id) => {
    if (!isValidVlmId(id)) return
    setVlmModelIdState(id)
    try {
      await AsyncStorage.setItem(VLM_MODEL_KEY, id)
    } catch (e) {
      console.warn('[modelContext] save vlmModelId failed:', e)
    }
  }, [])

  // VLM orchestrator が呼ぶ。値は永続化しない (アプリ再起動で常に false スタート)。
  const setPreventLlmLoad = useCallback((b) => {
    setPreventLlmLoadState(!!b)
  }, [])

  const activeModelId = currentRole === 'coach' ? coachModelId : parserModelId
  const activeModel = getAnyModelById(activeModelId)
  const parserEngine = getEngineFor(parserModelId)
  const coachEngine = getEngineFor(coachModelId)
  const activeEngine = getEngineFor(activeModelId)

  const value = useMemo(
    () => ({
      parserModelId,
      coachModelId,
      parserModel: getAnyModelById(parserModelId),
      coachModel: getAnyModelById(coachModelId),
      parserEngine,
      coachEngine,
      currentRole,
      activeModelId,
      activeModel,
      activeEngine,
      setParserModelId,
      setCoachModelId,
      setCurrentRole,
      markLoaded,
      fellBack,
      dismissFellBack,
      isLoaded,
      vlmEnabled,
      vlmModelId,
      setVlmEnabled,
      setVlmModelId,
      preventLlmLoad,
      setPreventLlmLoad,
    }),
    [
      parserModelId,
      coachModelId,
      parserEngine,
      coachEngine,
      currentRole,
      activeModelId,
      activeModel,
      activeEngine,
      setParserModelId,
      setCoachModelId,
      setCurrentRole,
      markLoaded,
      fellBack,
      dismissFellBack,
      isLoaded,
      vlmEnabled,
      vlmModelId,
      setVlmEnabled,
      setVlmModelId,
      preventLlmLoad,
      setPreventLlmLoad,
    ],
  )

  return (
    <ModelContext.Provider value={value}>
      <LLMProvider>{children}</LLMProvider>
    </ModelContext.Provider>
  )
}

// LLMProvider は ModelProvider の内側で動く。activeModel が変わると、
// その engine 側のフックが新しいモデルで再初期化される（hot-swap / role swap 共通の経路）。
//
// 設計:
//   - executorch hook (useLLM) と llama.rn hook (useLlamaRnLLM) を「両方常に呼ぶ」(React フックルール)
//   - 「アクティブな engine」だけ preventLoad=false で実ロード
//   - 「非アクティブな engine」は preventLoad=true → 各 hook が cleanup で解放
//   - VLM 排他 (preventLlmLoad=true) 中は両方の hook を preventLoad=true にする
//     (VLM 自体が llama.rn を別 context で動かしているため、 Metal Working Set を譲る)
//
// executorch hook は常に何かしらの model.source を要求する (preventLoad=true でも prop は必要)。
// アクティブが llama.rn のときは「parser or coach のうち executorch 側のモデル」を渡し、
// どちらも llama.rn なら DEFAULT_MODEL_ID (qwen3-0.6b-q) を placeholder として渡す。
// preventLoad=true なので実 DL / ロードは走らない。
const LLMProvider = ({ children }) => {
  const {
    parserModel,
    coachModel,
    activeModel,
    activeEngine,
    markLoaded,
    preventLlmLoad,
  } = useContext(ModelContext)

  // executorch hook 用の source を決定。
  //   1. アクティブが executorch → activeModel.source
  //   2. parser が executorch → parserModel.source (placeholder、 preventLoad=true で寝かせる)
  //   3. coach が executorch → coachModel.source (同上)
  //   4. どちらも llama.rn → DEFAULT_MODEL_ID の source (最終フォールバック)
  let executorchSource
  if (activeEngine === 'executorch') {
    executorchSource = activeModel.source
  } else if (parserModel.engine === 'executorch') {
    executorchSource = parserModel.source
  } else if (coachModel.engine === 'executorch') {
    executorchSource = coachModel.source
  } else {
    executorchSource = getExecutorchModelById(DEFAULT_MODEL_ID).source
  }

  // llama.rn hook 用の model 定義 (catalog 行) を決定。
  // ロジックは executorch と対称。 placeholder として LLM_LLAMA_RN_TEXT_MODELS[0] を使う。
  let llamaRnModel = null
  if (activeEngine === 'llama_rn') {
    llamaRnModel = activeModel
  } else if (parserModel.engine === 'llama_rn') {
    llamaRnModel = parserModel
  } else if (coachModel.engine === 'llama_rn') {
    llamaRnModel = coachModel
  } else {
    // 両方 executorch のときは llama.rn 側に渡すモデルがない → null で hook を待機状態に
    llamaRnModel = LLM_LLAMA_RN_TEXT_MODELS[0] ?? null
  }

  const executorchPreventLoad = preventLlmLoad || activeEngine !== 'executorch'
  const llamaRnPreventLoad = preventLlmLoad || activeEngine !== 'llama_rn'

  const executorchLLM = useLLM({ model: executorchSource, preventLoad: executorchPreventLoad })
  const llamaRnLLM = useLlamaRnLLM({ model: llamaRnModel, preventLoad: llamaRnPreventLoad })

  const llm = activeEngine === 'executorch' ? executorchLLM : llamaRnLLM

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
