import React from 'react'
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { colors, fontSize } from '../../theme'

const PORTIONS = [
  { value: 'small', label: '少なめ', factor: 0.7 },
  { value: 'normal', label: '並', factor: 1.0 },
  { value: 'large', label: '大盛り', factor: 1.3 },
]

const portionMeta = (value) => PORTIONS.find((p) => p.value === value) ?? PORTIONS[1]

export const cycleNextPortion = (value) => {
  const idx = PORTIONS.findIndex((p) => p.value === value)
  const next = PORTIONS[(idx + 1) % PORTIONS.length]
  return next.value
}

export const computeKcal = (item) => {
  if (item.baseKcal == null) return null
  return Math.round(item.baseKcal * portionMeta(item.portion).factor)
}

export default function FoodCard({ message, onUpdateItem, title }) {
  const items = message.foodItems ?? []
  const kcals = items.map(computeKcal)
  const hasUnknownKcal = kcals.some((k) => k == null)
  const totalKcal = kcals.reduce((sum, k) => sum + (k ?? 0), 0)
  const dailyTarget = message.dailyTotal?.target
  // Message container の maxWidth: 90% に追従しつつ、内部コンテンツ依存で縮まないよう
  // 画面幅から固定幅を計算する（gifted-chat の Bubble は文字列が押し広げる前提だが、
  // FoodCard は固定要素しかなく自然幅が小さくなるため）。
  const { width: screenWidth } = useWindowDimensions()
  // Message container は maxWidth: 90%。それを超えないよう少し小さめで固定。
  const cardWidth = Math.floor(screenWidth * 0.85)

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {items.map((item, i) => {
        const meta = portionMeta(item.portion)
        const kcal = kcals[i]
        return (
          <View key={item.id ?? `${item.name}-${i}`} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.detail}>
                {item.quantity}
                {item.unit} · {kcal == null ? '— kcal' : `${kcal} kcal`}
              </Text>
              {item.matchedName ? (
                <Text style={styles.matched} numberOfLines={1}>
                  ※ {item.matchedName}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.portionPill}
              onPress={() => onUpdateItem?.(message._id, item.id, { portion: cycleNextPortion(item.portion) })}
              activeOpacity={0.7}
            >
              <Text style={styles.portionText}>{meta.label}</Text>
            </TouchableOpacity>
          </View>
        )
      })}
      <View style={styles.total}>
        <Text style={styles.totalLabel}>合計</Text>
        <Text style={styles.totalValue}>
          {hasUnknownKcal ? '— kcal' : `${totalKcal} kcal`}
          {dailyTarget ? ` / ${dailyTarget} kcal` : ''}
        </Text>
      </View>
      <Text style={styles.hint}>ピルをタップで分量を変更</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginVertical: 4,
    marginHorizontal: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.lightGrayPurple,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grayFifth,
  },
  title: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grayFifth,
  },
  rowMain: {
    flex: 1,
    paddingRight: 8,
  },
  name: {
    fontSize: fontSize.middle,
    color: colors.black,
    fontWeight: '600',
  },
  detail: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 2,
  },
  matched: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    marginTop: 2,
    opacity: 0.7,
  },
  portionPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: colors.lightPurple,
  },
  portionText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
  },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.grayFifth,
  },
  totalLabel: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  totalValue: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  hint: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 8,
    textAlign: 'right',
  },
})
