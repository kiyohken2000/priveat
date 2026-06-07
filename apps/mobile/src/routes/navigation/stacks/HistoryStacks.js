import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import History from '../../../scenes/history/History'
import CalendarScreen from '../../../scenes/history/CalendarScreen'
import DayDetailScreen from '../../../scenes/history/DayDetailScreen'
import EditFoodScreen from '../../../scenes/history/EditFoodScreen'
import EditEnergyScreen from '../../../scenes/history/EditEnergyScreen'
import EditWeightScreen from '../../../scenes/history/EditWeightScreen'

const Stack = createStackNavigator()

// 'YYYY-MM-DD' → '2026年6月5日(金)' のような日本語タイトル。route.params.date 未指定時は無難なラベル。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const formatDateTitle = (dateStr) => {
  if (!dateStr) return '日詳細'
  try {
    const d = new Date(`${dateStr}T00:00:00`)
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`
  } catch (e) {
    return dateStr
  }
}

export const HistoryStacks = () => (
  <Stack.Navigator
    initialRouteName="History"
    screenOptions={navigationProps}
  >
    <Stack.Screen
      name="History"
      component={History}
      options={{
        title: '履歴',
        headerShown: false,
      }}
    />
    <Stack.Screen
      name="CalendarScreen"
      component={CalendarScreen}
      options={{ title: 'カレンダー' }}
    />
    <Stack.Screen
      name="DayDetailScreen"
      component={DayDetailScreen}
      options={({ route }) => ({
        title: formatDateTitle(route.params?.date),
      })}
    />
    <Stack.Screen
      name="EditFoodScreen"
      component={EditFoodScreen}
      options={{ title: '食事を編集' }}
    />
    <Stack.Screen
      name="EditEnergyScreen"
      component={EditEnergyScreen}
      options={{ title: '運動を編集' }}
    />
    <Stack.Screen
      name="EditWeightScreen"
      component={EditWeightScreen}
      options={{ title: '体重を編集' }}
    />
  </Stack.Navigator>
)
