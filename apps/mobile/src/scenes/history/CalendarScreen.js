import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Calendar, LocaleConfig } from 'react-native-calendars'
import { colors, fontSize } from '../../theme'
import { getDatesWithFoodLog } from '../../db/foodLogActions'

// 日本語ロケール設定（モジュール読み込み時に1度実行）。
LocaleConfig.locales.ja = {
  monthNames: [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
  ],
  monthNamesShort: [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
  ],
  dayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  dayNamesShort: ['日', '月', '火', '水', '木', '金', '土'],
}
LocaleConfig.defaultLocale = 'ja'

const todayLocal = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function CalendarScreen() {
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState(false)
  const [markedDates, setMarkedDates] = useState({})

  const load = useCallback(async () => {
    try {
      const dates = await getDatesWithFoodLog()
      const today = todayLocal()
      const marks = {}
      for (const d of dates) {
        marks[d] = { marked: true, dotColor: colors.lightPurple }
      }
      // 今日も常に強調
      marks[today] = { ...(marks[today] ?? {}), today: true }
      setMarkedDates(marks)
    } catch (err) {
      console.warn('[calendar] load error:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <View style={styles.root}>
      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.lightPurple} />
        </View>
      ) : (
        <Calendar
          markedDates={markedDates}
          onDayPress={(day) =>
            navigation.navigate('DayDetailScreen', { date: day.dateString })
          }
          theme={{
            backgroundColor: colors.white,
            calendarBackground: colors.white,
            textSectionTitleColor: colors.gray,
            selectedDayBackgroundColor: colors.lightPurple,
            selectedDayTextColor: colors.white,
            todayTextColor: colors.lightPurple,
            dayTextColor: colors.darkPurple,
            textDisabledColor: '#dcd9ec',
            dotColor: colors.lightPurple,
            arrowColor: colors.darkPurple,
            monthTextColor: colors.darkPurple,
            textMonthFontWeight: '700',
            textDayFontSize: fontSize.middle,
            textMonthFontSize: fontSize.large,
            textDayHeaderFontSize: fontSize.small,
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
})
