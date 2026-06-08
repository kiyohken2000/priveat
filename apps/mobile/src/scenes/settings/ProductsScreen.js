import { useFocusEffect, useNavigation } from '@react-navigation/native'
import React, { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../../theme'
import { listProducts } from '../../db/products'

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

const sourceLabel = (source) => {
  if (source === 'manual') return '手入力'
  if (source === 'label_ocr') return 'ラベル OCR'
  return source ?? '—'
}

const normalize = (s) => String(s ?? '').replace(/[\s\u3000]/g, '').toLowerCase()

const SOURCE_FILTERS = [
  { key: 'all', label: 'すべて' },
  { key: 'manual', label: '手入力' },
  { key: 'label_ocr', label: 'ラベル OCR' },
]

export default function ProductsScreen() {
  const navigation = useNavigation()
  const [loaded, setLoaded] = useState(false)
  const [products, setProducts] = useState([])
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      const rows = await listProducts({ limit: 200 })
      setProducts(rows ?? [])
    } catch (err) {
      console.warn('[products] list error:', err)
    } finally {
      setLoaded(true)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const filtered = useMemo(() => {
    const q = normalize(query)
    return products.filter((p) => {
      if (sourceFilter !== 'all' && p.source !== sourceFilter) return false
      if (q && !normalize(p.name).includes(q)) return false
      return true
    })
  }, [products, query, sourceFilter])

  const onAddNew = () => navigation.navigate('ProductEditScreen', {})

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.lightPurple} />
      </View>
    )
  }

  const hasAnyProducts = products.length > 0
  const isFilteringEmpty = hasAnyProducts && filtered.length === 0

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <Pressable
        onPress={onAddNew}
        style={({ pressed }) => [styles.addBtn, pressed && styles.btnPressed]}
      >
        <Text style={styles.addBtnText}>＋ 新しく登録</Text>
      </Pressable>

      {hasAnyProducts ? (
        <View style={styles.filterBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="名前で絞り込み"
            placeholderTextColor={colors.gray}
            style={styles.searchInput}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          <View style={styles.chipsRow}>
            {SOURCE_FILTERS.map((f) => {
              const active = sourceFilter === f.key
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setSourceFilter(f.key)}
                  style={({ pressed }) => [
                    styles.chip,
                    active && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      {!hasAnyProducts && (
        <View style={styles.emptyBox}>
          <FontIcon name="cube" size={32} color={colors.gray} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>登録済みのマイ食品はありません</Text>
          <Text style={styles.emptyHint}>
            記録モードで栄養ラベルを撮影するか{'\n'}
            「＋ 新しく登録」 から手入力できます
          </Text>
        </View>
      )}

      {isFilteringEmpty && (
        <View style={styles.emptyBox}>
          <FontIcon name="search" size={28} color={colors.gray} style={styles.emptyIcon} />
          <Text style={styles.emptyHint}>条件に一致するマイ食品はありません</Text>
        </View>
      )}

      {hasAnyProducts && !isFilteringEmpty && (
        <View style={styles.section}>
          {filtered.map((p, i) => (
            <React.Fragment key={p.id}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <Pressable
                onPress={() => navigation.navigate('ProductEditScreen', { id: p.id })}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                {p.image_uri ? (
                  <Image source={{ uri: p.image_uri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <FontIcon name="cube" size={16} color={colors.gray} />
                  </View>
                )}
                <View style={styles.rowMain}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {p.kcal != null ? `${Math.round(p.kcal)} kcal` : '— kcal'}
                    {p.serving_desc ? ` / ${p.serving_desc}` : ''}
                    {' · '}
                    {sourceLabel(p.source)}
                    {' · '}
                    {formatCreated(p.created_at)}
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
  addBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lightPurple,
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: colors.white,
    marginBottom: 16,
  },
  addBtnText: {
    fontSize: fontSize.small,
    color: colors.lightPurple,
    fontWeight: '600',
  },
  btnPressed: { opacity: 0.7 },
  filterBox: {
    marginBottom: 12,
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
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e0dcf0',
    backgroundColor: colors.white,
    marginRight: 8,
    marginBottom: 4,
  },
  chipActive: {
    backgroundColor: colors.lightPurple,
    borderColor: colors.lightPurple,
  },
  chipPressed: { opacity: 0.7 },
  chipText: {
    fontSize: fontSize.small,
    color: colors.gray,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.white,
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
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: '#f4f3fb' },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 6,
    marginRight: 12,
  },
  thumbPlaceholder: {
    backgroundColor: '#f0eef7',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    marginLeft: 66,
  },
})
