import React, { useState } from 'react'
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import FoodNameInput from '../../components/FoodNameInput'

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

function FoodRow({ item, kcal, messageId, onUpdateItem, onDeleteItem }) {
  const meta = portionMeta(item.portion)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.name ?? '')

  const startEdit = () => {
    setDraft(item.name ?? '')
    setEditing(true)
  }
  const commitEdit = () => {
    // onSubmitEditing → blurOnSubmit が onBlur を続けて発火させるので二重起動を防ぐ。
    if (!editing) return
    setEditing(false)
    const next = draft.trim()
    if (!next || next === item.name) return
    onUpdateItem?.(messageId, item.id, { name: next })
  }
  const cancelEdit = () => {
    setDraft(item.name ?? '')
    setEditing(false)
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        {editing ? (
          <FoodNameInput
            style={styles.nameInput}
            value={draft}
            onChangeText={setDraft}
            onCommit={(picked) => {
              setDraft(picked)
              setEditing(false)
              if (picked && picked !== item.name) {
                onUpdateItem?.(messageId, item.id, { name: picked })
              }
            }}
            onBlur={commitEdit}
            onSubmitEditing={commitEdit}
            autoFocus
            returnKeyType="done"
            blurOnSubmit
            placeholder="料理名"
            placeholderTextColor={colors.grayFifth}
          />
        ) : (
          <TouchableOpacity onPress={startEdit} activeOpacity={0.6}>
            <Text style={styles.name}>{item.name}</Text>
          </TouchableOpacity>
        )}
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
        onPress={() =>
          onUpdateItem?.(messageId, item.id, { portion: cycleNextPortion(item.portion) })
        }
        activeOpacity={0.7}
        disabled={editing}
      >
        <Text style={styles.portionText}>{meta.label}</Text>
      </TouchableOpacity>
      {editing ? (
        <TouchableOpacity onPress={cancelEdit} style={styles.iconBtn} activeOpacity={0.6}>
          <Text style={styles.cancelText}>×</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          onPress={() => onDeleteItem?.(messageId, item.id)}
          style={styles.iconBtn}
          activeOpacity={0.6}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Text style={styles.deleteText}>×</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export default function FoodCard({ message, onUpdateItem, onDeleteItem, title }) {
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

  if (items.length === 0) {
    return (
      <View style={[styles.card, { width: cardWidth }]}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        <Text style={styles.emptyHint}>すべての行を削除しました</Text>
      </View>
    )
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message.truncated ? (
        <Text style={styles.warn}>
          ※ AI の出力が途中で切れた可能性があります。取りこぼした品目があれば追加で入力するか、料理を分けて送信してください。設定からより大きな parser モデル (Qwen3 1.7B など) に切り替えると改善する場合があります。
        </Text>
      ) : null}
      {items.map((item, i) => (
        <FoodRow
          key={item.id ?? `${item.name}-${i}`}
          item={item}
          kcal={kcals[i]}
          messageId={message._id}
          onUpdateItem={onUpdateItem}
          onDeleteItem={onDeleteItem}
        />
      ))}
      <View style={styles.total}>
        <Text style={styles.totalLabel}>合計</Text>
        <Text style={styles.totalValue}>
          {hasUnknownKcal ? '— kcal' : `${totalKcal} kcal`}
          {dailyTarget ? ` / ${dailyTarget} kcal` : ''}
        </Text>
      </View>
      <Text style={styles.hint}>料理名タップで編集 / ピルで分量 / × で削除</Text>
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
  nameInput: {
    fontSize: fontSize.middle,
    color: colors.black,
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: colors.darkPurple,
    paddingVertical: 0,
    paddingHorizontal: 0,
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
  iconBtn: {
    marginLeft: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: fontSize.middle,
    color: colors.gray,
    fontWeight: '600',
  },
  cancelText: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
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
  emptyHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    paddingVertical: 8,
    textAlign: 'center',
  },
  warn: {
    fontSize: fontSize.small,
    color: colors.redPrimary,
    marginBottom: 6,
    lineHeight: 16,
  },
})
