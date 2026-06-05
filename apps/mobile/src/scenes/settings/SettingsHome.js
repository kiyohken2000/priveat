import { useNavigation } from '@react-navigation/native'
import React from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'
import { images } from '../../theme/images'
import { version } from '../../config'
import { useActiveModel } from '../../state/modelContext'

const Row = ({ icon, title, subtitle, subtitleLines = 1, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    <View style={styles.iconBox}>
      <FontIcon name={icon} size={18} color={colors.lightPurple} />
    </View>
    <View style={styles.rowMain}>
      <Text style={styles.rowTitle}>{title}</Text>
      {subtitle ? (
        <Text style={styles.rowSubtitle} numberOfLines={subtitleLines}>
          {subtitle}
        </Text>
      ) : null}
    </View>
    <FontIcon name="chevron-right" size={14} color={colors.gray} />
  </Pressable>
)

export default function SettingsHome() {
  const navigation = useNavigation()
  const { parserModel, coachModel } = useActiveModel()

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
            icon="commenting-o"
            title="コーチへの指示"
            subtitle="目標・アドバイスの傾向などを自由文で"
            onPress={() => navigation.navigate('StanceScreen')}
          />
          <View style={styles.divider} />
          <Row
            icon="microchip"
            title="LLM モデル"
            subtitle={`記録: ${parserModel.label}\nコーチ: ${coachModel.label}`}
            subtitleLines={2}
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

        <View style={styles.about}>
          <Image source={images.logo_sm} style={styles.aboutLogo} resizeMode="contain" />
          <Text style={styles.aboutAppName}>Priveat</Text>
          <Text style={styles.aboutVersion}>バージョン {version}</Text>
          <Text style={styles.aboutCredit}>
            成分データ: 日本食品標準成分表（八訂）増補2023年（文部科学省）から引用
          </Text>
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
  about: {
    alignItems: 'center',
    marginTop: 32,
    paddingVertical: 20,
  },
  aboutLogo: {
    width: 56,
    height: 56,
    borderRadius: 12,
    marginBottom: 8,
  },
  aboutAppName: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  aboutVersion: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 2,
  },
  aboutCredit: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 16,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 18,
  },
})
