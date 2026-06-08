import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../../theme'
import { listRecipes } from '../../db/recipes'

const formatCreated = (iso) => {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}/${m}/${day}`
  } catch (e) {
    return ''
  }
}

const normalize = (s) => String(s ?? '').replace(/[\s\u3000]/g, '').toLowerCase()

export default function RecipesScreen() {
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState(false)
  const [recipes, setRecipes] = useState([])
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const rows = await listRecipes({ limit: 200 })
      setRecipes(rows ?? [])
    } catch (err) {
      console.warn('[recipes] list error:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  // 編集画面から戻ってきたら再読込 (保存・削除の反映)。
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const filtered = useMemo(() => {
    const q = normalize(query)
    if (!q) return recipes
    return recipes.filter((r) => normalize(r.name).includes(q))
  }, [recipes, query])

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.lightPurple} />
      </View>
    )
  }

  if (recipes.length === 0) {
    return (
      <View style={styles.center}>
        <FontIcon name="cutlery" size={32} color={colors.gray} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>登録済みのレシピはありません</Text>
        <Text style={styles.emptyHint}>
          チャットの「レシピ」モードで{'\n'}まとめ作りを登録するとここに並びます
        </Text>
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="名前で絞り込み"
        placeholderTextColor={colors.gray}
        style={styles.searchInput}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      {filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <FontIcon name="search" size={28} color={colors.gray} style={styles.emptyIcon} />
          <Text style={styles.emptyHint}>条件に一致するレシピはありません</Text>
        </View>
      ) : (
        <View style={styles.section}>
          {filtered.map((r, i) => (
            <React.Fragment key={r.id}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                onPress={() => navigation.navigate('RecipeEditScreen', { id: r.id })}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.name}>{r.name}</Text>
                  <Text style={styles.meta}>
                    {r.kcal_per_serving != null
                      ? `${r.kcal_per_serving} kcal / 食`
                      : '— kcal / 食'}
                    {' · '}
                    {r.servings} 食分
                    {' · '}
                    {formatCreated(r.created_at)}
                  </Text>
                </View>
                <FontIcon name="chevron-right" size={14} color={colors.gray} />
              </Pressable>
            </React.Fragment>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { padding: 20, paddingBottom: 40, backgroundColor: colors.lightGrayPurple, flexGrow: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lightGrayPurple,
    padding: 20,
  },
  searchInput: {
    backgroundColor: colors.white,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    borderWidth: 1,
    borderColor: '#e8e6f1',
    marginBottom: 12,
  },
  emptyBox: {
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: { marginBottom: 12, opacity: 0.5 },
  emptyTitle: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    textAlign: 'center',
    lineHeight: 20,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowPressed: { backgroundColor: '#f4f3fb' },
  rowMain: { flex: 1, paddingRight: 8 },
  name: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#f0eef7',
    marginLeft: 14,
  },
})
