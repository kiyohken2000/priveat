import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'
import { useActiveModel } from '../../state/modelContext'

const Row = ({ icon, title, subtitle, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    <View style={styles.iconBox}>
      <FontIcon name={icon} size={18} color={colors.lightPurple} />
    </View>
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle}>{title}</Text>
      {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
    </View>
    <FontIcon name="chevron-right" size={14} color={colors.gray} />
  </Pressable>
)

export default function SettingsHome() {
  const navigation = useNavigation()
  const { activeModel } = useActiveModel()

  return (
    <ScreenTemplate>
      <ScrollView contentContainerStyle={styles.root}>
        <Text style={styles.title}>設定</Text>

        <View style={styles.section}>
          <Row
            icon="user"
            title="プロフィール"
            subtitle="年齢・性別・身長・体重"
            onPress={() => navigation.navigate('ProfileScreen')}
          />
          <View style={styles.divider} />
          <Row
            icon="microchip"
            title="LLM モデル"
            subtitle={`現在: ${activeModel.label}`}
            onPress={() => navigation.navigate('ModelScreen')}
          />
          <View style={styles.divider} />
          <Row
            icon="heart"
            title="ヘルス連携"
            subtitle="HealthKit / Health Connect"
            onPress={() => navigation.navigate('HealthScreen')}
          />
        </View>
      </ScrollView>
    </ScreenTemplate>
  )
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingBottom: 40 },
  title: {
    fontSize: fontSize.xxxLarge,
    fontWeight: '700',
    marginBottom: 20,
    color: colors.darkPurple,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: '#f4f3fb' },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f4f3fb',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: fontSize.middle, color: colors.darkPurple, fontWeight: '600' },
  rowSubtitle: { fontSize: fontSize.small, color: colors.gray, marginTop: 2 },
  divider: {
    height: 1,
    backgroundColor: '#f0eef7',
    marginLeft: 58,
  },
})
