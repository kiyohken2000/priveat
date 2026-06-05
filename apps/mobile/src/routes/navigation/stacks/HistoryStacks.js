import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import History from '../../../scenes/history/History'
import CalendarScreen from '../../../scenes/history/CalendarScreen'
import DayDetailScreen from '../../../scenes/history/DayDetailScreen'
import EditFoodScreen from '../../../scenes/history/EditFoodScreen'

const Stack = createStackNavigator()

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
      options={{ title: '日詳細' }}
    />
    <Stack.Screen
      name="EditFoodScreen"
      component={EditFoodScreen}
      options={{ title: '食事を編集' }}
    />
  </Stack.Navigator>
)
