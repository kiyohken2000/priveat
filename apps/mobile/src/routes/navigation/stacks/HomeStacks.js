import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import Home from '../../../scenes/home/Home'
import EditFoodScreen from '../../../scenes/history/EditFoodScreen'

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
  </Stack.Navigator>
)
