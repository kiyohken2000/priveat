import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import SettingsHome from '../../../scenes/settings/SettingsHome'
import ProfileScreen from '../../../scenes/settings/ProfileScreen'
import ModelScreen from '../../../scenes/settings/ModelScreen'
import HealthScreen from '../../../scenes/settings/HealthScreen'

const Stack = createStackNavigator()

export const SettingsStacks = () => (
  <Stack.Navigator
    initialRouteName="SettingsHome"
    screenOptions={navigationProps}
  >
    <Stack.Screen
      name="SettingsHome"
      component={SettingsHome}
      options={{
        title: '設定',
        headerShown: false,
      }}
    />
    <Stack.Screen
      name="ProfileScreen"
      component={ProfileScreen}
      options={{ title: 'プロフィール' }}
    />
    <Stack.Screen
      name="ModelScreen"
      component={ModelScreen}
      options={{ title: 'LLM モデル' }}
    />
    <Stack.Screen
      name="HealthScreen"
      component={HealthScreen}
      options={{ title: 'ヘルス連携' }}
    />
  </Stack.Navigator>
)
