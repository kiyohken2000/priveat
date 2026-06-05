import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import { colors, fontSize } from '../theme'

// データの出所を表すバッジ。
//   source: 'health' | 'ocr' | 'label_ocr' | 'text_llm' | 'manual' | null
//   hasImage: true なら OCR バッジを Pressable にして onPressImage を発火する。
//
// マッピング:
//   health         → ❤️ ヘルス
//   ocr/label_ocr  → 📷 OCR
//   text_llm       → 💬 チャット
//   manual / null  → ✏️ 手入力
const MAP = {
  health:    { icon: 'heart',          label: 'ヘルス',   bg: '#fde2e6', fg: '#c2185b' },
  ocr:       { icon: 'camera',         label: 'OCR',      bg: '#e1ecff', fg: '#1e4a9b' },
  label_ocr: { icon: 'camera',         label: 'OCR',      bg: '#e1ecff', fg: '#1e4a9b' },
  text_llm:  { icon: 'comment',        label: 'チャット', bg: '#ede7f6', fg: '#5e35b1' },
  manual:    { icon: 'pencil',         label: '手入力',   bg: '#f0eef7', fg: colors.darkPurple },
}

const resolve = (source) => MAP[source] ?? MAP.manual

export default function SourceBadge({ source, hasImage, onPressImage, compact }) {
  const cfg = resolve(source)
  const isOcr = source === 'ocr' || source === 'label_ocr'
  const tappable = isOcr && hasImage && onPressImage

  const inner = (
    <View
      style={[
        styles.badge,
        { backgroundColor: cfg.bg },
        compact && styles.badgeCompact,
      ]}
    >
      <FontIcon name={cfg.icon} size={compact ? 9 : 10} color={cfg.fg} />
      {!compact && (
        <Text style={[styles.text, { color: cfg.fg }]}>{cfg.label}</Text>
      )}
      {tappable && !compact && (
        <FontIcon name="image" size={9} color={cfg.fg} style={styles.imgHint} />
      )}
    </View>
  )

  if (!tappable) return inner

  return (
    <Pressable
      onPress={onPressImage}
      hitSlop={6}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {inner}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeCompact: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  text: {
    fontSize: fontSize.small - 2,
    fontWeight: '600',
    marginLeft: 3,
  },
  imgHint: { marginLeft: 4 },
  pressed: { opacity: 0.6 },
})
