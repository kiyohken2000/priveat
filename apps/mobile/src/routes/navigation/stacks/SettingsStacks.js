import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import Settings from '../../../scenes/settings/Settings'

const Stack = createStackNavigator()

export const SettingsStacks = () => (
  <Stack.Navigator
    initialRouteName="Settings"
    screenOptions={navigationProps}
  >
    <Stack.Screen
      name="Settings"
      component={Settings}
      options={{
        title: '設定',
        headerShown: false,
      }}
    />
  </Stack.Navigator>
)
