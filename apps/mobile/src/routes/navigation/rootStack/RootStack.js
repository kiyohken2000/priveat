import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import TabNavigator from '../tabs/Tabs'

const Stack = createStackNavigator()

export default function RootStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen
        name="HomeRoot"
        component={TabNavigator}
      />
    </Stack.Navigator>
  )
}
