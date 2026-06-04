import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'

export default function Settings() {
  return (
    <ScreenTemplate>
      <View style={styles.root}>
        <Text style={styles.title}>設定</Text>
        <Text style={styles.subtitle}>目標値・モデル選択・ヘルス連携（順次実装）</Text>
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
