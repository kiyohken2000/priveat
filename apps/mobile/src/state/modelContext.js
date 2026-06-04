import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_MODEL_ID, LLM_MODELS, getModelById } from '../data/llmModels'

const STORAGE_KEY = '@priveat/active-model-id'

const ModelContext = createContext({
  activeModelId: DEFAULT_MODEL_ID,
  activeModel: getModelById(DEFAULT_MODEL_ID),
  setActiveModelId: () => {},
  isLoaded: false,
})

// アプリ起動時に AsyncStorage から activeModelId を読み込み、
// ModelScreen から切り替えると即時で Chat の useLLM に伝播する（hot-swap）。
export const ModelProvider = ({ children }) => {
  const [activeModelId, setActiveModelIdState] = useState(DEFAULT_MODEL_ID)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (cancelled) return
        if (v && LLM_MODELS.some((m) => m.id === v)) {
          setActiveModelIdState(v)
        }
      })
      .catch((e) => console.warn('[modelContext] load failed:', e))
      .finally(() => {
        if (!cancelled) setIsLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setActiveModelId = useCallback(async (id) => {
    if (!LLM_MODELS.some((m) => m.id === id)) return
    setActiveModelIdState(id)
    try {
      await AsyncStorage.setItem(STORAGE_KEY, id)
    } catch (e) {
      console.warn('[modelContext] save failed:', e)
    }
  }, [])

  const value = useMemo(
    () => ({
      activeModelId,
      activeModel: getModelById(activeModelId),
      setActiveModelId,
      isLoaded,
    }),
    [activeModelId, setActiveModelId, isLoaded],
  )

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>
}

export const useActiveModel = () => useContext(ModelContext)
