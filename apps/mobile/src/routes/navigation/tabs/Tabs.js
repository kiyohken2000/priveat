import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors } from 'theme'

// stack navigators
import { ChatStacks } from '../stacks/ChatStacks'
import { HomeStacks } from '../stacks/HomeStacks'
import { HistoryStacks } from '../stacks/HistoryStacks'
import { SettingsStacks } from '../stacks/SettingsStacks'

const Tab = createBottomTabNavigator()

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.lightPurple,
        tabBarInactiveTintColor: colors.gray,
        tabBarHideOnKeyboard: true,
      }}
      initialRouteName="HomeTab"
    >
      <Tab.Screen
        name="ChatTab"
        component={ChatStacks}
        options={{
          tabBarLabel: 'チャット',
          tabBarIcon: ({ color, size }) => (
            <FontIcon name="comments" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="HomeTab"
        component={HomeStacks}
        options={{
          tabBarLabel: 'ホーム',
          tabBarIcon: ({ color, size }) => (
            <FontIcon name="home" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="HistoryTab"
        component={HistoryStacks}
        options={{
          tabBarLabel: '履歴',
          tabBarIcon: ({ color, size }) => (
            <FontIcon name="history" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="SettingsTab"
        component={SettingsStacks}
        options={{
          tabBarLabel: '設定',
          tabBarIcon: ({ color, size }) => (
            <FontIcon name="cog" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  )
}
