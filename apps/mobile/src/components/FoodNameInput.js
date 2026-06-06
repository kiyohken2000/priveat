import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { defaultUnitForName } from '../data/portionWeights'
import { searchFoodsByName } from '../db/search'
import { colors, fontSize } from '../theme'

// 食品名 TextInput の共通コンポーネント。入力中に foods テーブルを検索して
// 直下に候補を表示する。タップで確定 → onChangeText / onCommit を発火。
//
// 使い方:
//   <FoodNameInput
//     value={name}
//     onChangeText={setName}
//     onCommit={(picked, food) => {...}}     // 候補タップで呼ばれる (任意)
//     placeholder="例: ハンバーガー"
//     style={styles.input}                    // TextInput 自体に当てる style
//     containerStyle={...}                    // ラッパー View の style (任意)
//     editable={!busy}
//     autoFocus
//   />
//
// 注意点:
//   - 候補ボックスは絶対配置せず、TextInput の真下に通常フローで展開する
//     (GiftedChat の Bubble の overflow:hidden に当たらないようにするため)。
//   - onBlur と候補タップのレース対策で blur は 150ms 遅延でリストを閉じる。

const DEBOUNCE_MS = 200
const MAX_RESULTS = 5

export default function FoodNameInput({
  value,
  onChangeText,
  onCommit,
  onBlur: outerOnBlur,
  onFocus: outerOnFocus,
  onSubmitEditing: outerOnSubmitEditing,
  style,
  containerStyle,
  ...rest
}) {
  const [suggestions, setSuggestions] = useState([])
  const [showSuggest, setShowSuggest] = useState(false)
  const focusedRef = useRef(false)
  // 候補タップ直後の onChangeText で再検索しないためのフラグ
  const skipNextRef = useRef(false)
  // blur で閉じる際の遅延を candidate タップでキャンセルするための timer ref
  const blurTimerRef = useRef(null)
  // 非同期検索の競合対策 (最後のクエリ以外は捨てる)
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      setSuggestions([])
      setShowSuggest(false)
      return undefined
    }
    if (!focusedRef.current) return undefined
    const q = (value ?? '').trim()
    if (!q) {
      setSuggestions([])
      setShowSuggest(false)
      return undefined
    }
    const myId = ++reqIdRef.current
    const t = setTimeout(async () => {
      try {
        const rows = await searchFoodsByName(q, MAX_RESULTS)
        if (reqIdRef.current !== myId) return
        setSuggestions(rows)
        setShowSuggest(rows.length > 0)
      } catch (e) {
        if (reqIdRef.current !== myId) return
        console.warn('[FoodNameInput] search failed:', e?.message ?? e)
        setSuggestions([])
        setShowSuggest(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value])

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    },
    [],
  )

  const onFocus = (e) => {
    focusedRef.current = true
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    if ((value ?? '').trim() && suggestions.length > 0) setShowSuggest(true)
    outerOnFocus?.(e)
  }

  const onBlur = (e) => {
    // 候補タップを onBlur が追い越さないよう少し遅延してから閉じる。
    blurTimerRef.current = setTimeout(() => {
      focusedRef.current = false
      setShowSuggest(false)
      blurTimerRef.current = null
    }, 150)
    outerOnBlur?.(e)
  }

  const pickSuggestion = (food) => {
    skipNextRef.current = true
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    setShowSuggest(false)
    onChangeText?.(food.name)
    // 第3引数として「この食品にふさわしい既定単位」を渡す。
    // foods テーブルには単位カラムが無いので portionWeights.js の登録から推定する。
    // ヒットしないことも多い (= 呼び元は受け取った値が null なら何もしない)。
    const suggestedUnit = defaultUnitForName(food.name)
    onCommit?.(food.name, food, suggestedUnit)
  }

  return (
    <View style={containerStyle}>
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        onSubmitEditing={outerOnSubmitEditing}
        style={style}
      />
      {showSuggest && suggestions.length > 0 ? (
        <View style={styles.suggestBox}>
          {suggestions.map((food, i) => (
            <TouchableOpacity
              key={food.id ?? `${food.name}-${i}`}
              onPress={() => pickSuggestion(food)}
              activeOpacity={0.6}
              style={[
                styles.suggestRow,
                i < suggestions.length - 1 && styles.suggestRowBorder,
              ]}
            >
              <Text style={styles.suggestName} numberOfLines={1}>
                {food.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  suggestBox: {
    marginTop: 4,
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grayFifth,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  suggestRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grayFifth,
  },
  suggestName: {
    fontSize: fontSize.small,
    color: colors.black,
    flex: 1,
  },
})
