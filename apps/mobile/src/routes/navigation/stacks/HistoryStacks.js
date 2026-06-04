import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import History from '../../../scenes/history/History'

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
  </Stack.Navigator>
)
