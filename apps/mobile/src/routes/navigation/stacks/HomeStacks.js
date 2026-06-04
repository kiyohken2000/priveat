import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import Home from '../../../scenes/home/Home'

const Stack = createStackNavigator()

export const HomeStacks = () => (
  <Stack.Navigator
    initialRouteName="Home"
    screenOptions={navigationProps}
  >
    <Stack.Screen
      name="Home"
      component={Home}
      options={{
        title: 'ホーム',
        headerShown: false,
      }}
    />
  </Stack.Navigator>
)
