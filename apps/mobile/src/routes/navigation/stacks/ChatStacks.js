import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import Chat from '../../../scenes/chat/Chat'

const Stack = createStackNavigator()

export const ChatStacks = () => (
  <Stack.Navigator
    initialRouteName="Chat"
    screenOptions={navigationProps}
  >
    <Stack.Screen
      name="Chat"
      component={Chat}
      options={{
        title: 'チャット',
        headerShown: false,
      }}
    />
  </Stack.Navigator>
)
