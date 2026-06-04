import React, { useState, useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Provider } from 'react-redux'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { initExecutorch } from 'react-native-executorch'
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher'
import store from 'utils/store'
import 'utils/ignore'
import { initDb } from './db'

// assets
import { imageAssets } from 'theme/images'
import { fontAssets } from 'theme/fonts'
import { colors, fontSize } from 'theme'
import Router from './routes'

initExecutorch({ resourceFetcher: ExpoResourceFetcher })

export default function App() {
  const [didLoad, setDidLoad] = useState(false)
  const [seedProgress, setSeedProgress] = useState(null)

  const handleInit = async () => {
    await Promise.all([
      initDb({
        onSeedProgress: (current, total) => setSeedProgress({ current, total }),
      }),
      ...imageAssets,
      ...fontAssets,
    ])
    setDidLoad(true)
  }

  useEffect(() => {
    handleInit()
  }, [])

  if (!didLoad) {
    const pct = seedProgress
      ? Math.round((seedProgress.current / seedProgress.total) * 100)
      : 0
    return (
      <SafeAreaProvider>
        <View style={loadingStyles.container}>
          <ActivityIndicator size="large" color={colors.lightPurple} />
          <Text style={loadingStyles.title}>起動中…</Text>
          {seedProgress && (
            <>
              <Text style={loadingStyles.subtitle}>
                食品DBを準備しています {seedProgress.current} / {seedProgress.total}
              </Text>
              <View style={loadingStyles.progressTrack}>
                <View style={[loadingStyles.progressFill, { width: `${pct}%` }]} />
              </View>
              <Text style={loadingStyles.note}>初回のみ。次回以降は出ません。</Text>
            </>
          )}
        </View>
      </SafeAreaProvider>
    )
  }
  return (
    <SafeAreaProvider>
      <Provider store={store}>
        <Router />
      </Provider>
    </SafeAreaProvider>
  )
}

const loadingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: fontSize.xLarge,
    fontWeight: '700',
    marginTop: 16,
    color: colors.darkPurple,
  },
  subtitle: {
    fontSize: fontSize.middle,
    marginTop: 12,
    color: colors.darkPurple,
  },
  progressTrack: {
    width: '80%',
    height: 6,
    backgroundColor: colors.grayFifth,
    borderRadius: 3,
    marginTop: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.lightPurple,
  },
  note: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 12,
  },
})
