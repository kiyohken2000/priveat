import React from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, fontSize } from '../theme'

// 単位入力。 上段の横スクロールチップで頻出単位を即タップ、
// 下段の TextInput で自由入力 (チップに無い単位やカスタム表記用) も残す。
//
// Props:
//   value         : 現在値 (string)
//   onChangeText  : 値変更コールバック
//   suggestions   : チップに並べる単位の配列 (例: ['杯','個','枚','本','玉','g'])
//   placeholder   : TextInput のプレースホルダ
//   inputStyle    : TextInput に追加で当てるスタイル (枠線など呼び出し元の input style)
//   rightSlot     : TextInput の右隣に並べる要素 (AI 推定ボタン等)
//   chipsBelow    : true ならチップを TextInput の下に配置 (デフォルト false = 上)

export default function UnitChipsInput({
  value,
  onChangeText,
  suggestions = [],
  placeholder,
  inputStyle,
  rightSlot,
  chipsBelow = false,
}) {
  const current = (value ?? '').trim()
  const chips =
    suggestions.length > 0 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chipsRow, chipsBelow && styles.chipsRowBelow]}
      >
        {suggestions.map((u) => {
          const selected = current === u
          return (
            <Pressable
              key={u}
              onPress={() => onChangeText?.(u)}
              style={({ pressed }) => [
                styles.chip,
                selected && styles.chipSelected,
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{u}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
    ) : null
  const inputRow = (
    <View style={[styles.inputRow, chipsBelow && styles.inputRowFirst]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.gray}
        style={[styles.input, styles.inputFlex, inputStyle]}
      />
      {rightSlot}
    </View>
  )
  return (
    <View>
      {chipsBelow ? inputRow : chips}
      {chipsBelow ? chips : inputRow}
    </View>
  )
}

const styles = StyleSheet.create({
  chipsRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingRight: 8,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    backgroundColor: colors.white,
  },
  chipSelected: {
    backgroundColor: colors.lightPurple,
    borderColor: colors.lightPurple,
  },
  chipPressed: { opacity: 0.6 },
  chipText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  chipTextSelected: { color: colors.white },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  // chipsBelow のとき TextInput が先頭にくるので marginTop を打ち消す。
  inputRowFirst: { marginTop: 0 },
  // chipsBelow のときは TextInput と chips の間に余白を入れる。
  chipsRowBelow: { marginTop: 10 },
  inputFlex: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#dcd9ec',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    backgroundColor: '#fafafe',
  },
})
