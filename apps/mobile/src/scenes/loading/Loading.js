import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { fontSize } from 'theme'

export default function Loading() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.label}>Loading...</Text>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.xxxLarge,
    fontWeight: '700',
  },
})
