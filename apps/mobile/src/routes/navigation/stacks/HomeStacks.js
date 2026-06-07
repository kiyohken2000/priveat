import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import Home from '../../../scenes/home/Home'
import EditFoodScreen from '../../../scenes/history/EditFoodScreen'
import EditEnergyScreen from '../../../scenes/history/EditEnergyScreen'
import EditWeightScreen from '../../../scenes/history/EditWeightScreen'

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
