import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { Provider } from 'react-redux'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initExecutorch } from 'react-native-executorch'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import store from 'utils/store'
import 'utils/ignore'

// assets
import { imageAssets } from 'theme/images'
import { fontAssets } from 'theme/fonts'
import Router from './routes'

initExecutorch({ resourceFetcher: ExpoResourceFetcher })

export default function App() {
  const [didLoad, setDidLoad] = useState(false)

  const handleLoadAssets = async () => {
    await Promise.all([...imageAssets, ...fontAssets])
    setDidLoad(true)
  }

  useEffect(() => {
    handleLoadAssets()
  }, [])

  if (!didLoad) return <View />
  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <Router />
      </Provider>
    </SafeAreaProvider>
  )
}
