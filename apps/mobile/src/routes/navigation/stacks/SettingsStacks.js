import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { navigationProps } from './navigationProps/navigationProps'

import SettingsHome from '../../../scenes/settings/SettingsHome'
import ProfileScreen from '../../../scenes/settings/ProfileScreen'
import ModelScreen from '../../../scenes/settings/ModelScreen'
import HealthScreen from '../../../scenes/settings/HealthScreen'
import StanceScreen from '../../../scenes/settings/StanceScreen'
import BenchmarkScreen from '../../../scenes/settings/BenchmarkScreen'
import RecipesScreen from '../../../scenes/settings/RecipesScreen'
import RecipeEditScreen from '../../../scenes/settings/RecipeEditScreen'
import ProductsScreen from '../../../scenes/settings/ProductsScreen'
import ProductEditScreen from '../../../scenes/settings/ProductEditScreen'

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
    <Stack.Screen
      name="StanceScreen"
      component={StanceScreen}
      options={{ title: 'コーチへの指示' }}
    />
    <Stack.Screen
      name="BenchmarkScreen"
      component={BenchmarkScreen}
      options={{ title: 'モデル比較' }}
    />
    <Stack.Screen
      name="RecipesScreen"
      component={RecipesScreen}
      options={{ title: '自炊レシピ' }}
    />
    <Stack.Screen
      name="RecipeEditScreen"
      component={RecipeEditScreen}
      options={{ title: 'レシピを編集' }}
    />
    <Stack.Screen
      name="ProductsScreen"
      component={ProductsScreen}
      options={{ title: 'マイ食品' }}
    />
    <Stack.Screen
      name="ProductEditScreen"
      component={ProductEditScreen}
      options={{ title: 'マイ食品を編集' }}
    />
  </Stack.Navigator>
)
