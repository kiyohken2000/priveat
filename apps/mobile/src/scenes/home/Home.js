import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'

export default function Home() {
  return (
    <ScreenTemplate>
      <View style={styles.root}>
        <Text style={styles.title}>ホーム</Text>
        <Text style={styles.subtitle}>今日のサマリー（摂取/消費/収支）はフェーズ7で実装</Text>
      </View>
    </ScreenTemplate>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: fontSize.xxxLarge,
    fontWeight: '700',
    marginBottom: 12,
    color: colors.darkPurple,
  },
  subtitle: {
    fontSize: fontSize.middle,
    color: colors.gray,
    textAlign: 'center',
  },
})
