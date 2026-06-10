import React, { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, fontSize } from '../theme'

// あすけん風の数値入力モーダル。 OS 標準キーボードを使わずに自作テンキーで
// 数量 / kcal を 1 画面で打てるようにする。 トグルで 「数量」 と 「kcal」 の
// どちらに入力中かを切り替える (値の換算はしない — それぞれ独立した文字列を保持)。
//
// Props:
//   visible        : 表示制御
//   title          : ヘッダタイトル (デフォルト '分量・カロリー')
//   subtitle       : 食品名等の補助表示
//   initialMode    : 'quantity' | 'kcal' (起動時のモード)
//   quantityValue  : 数量の初期値 (string)
//   quantityUnit   : 数量の単位ラベル ('杯', '個', 'g' 等)
//   kcalValue      : kcal の初期値 (string)
//   perUnitKcal    : 1 単位あたりの kcal (目安バナー用、 不明なら null)
//   allowToggle    : モード切替ボタンを出すか (デフォルト true)
//   onSubmit       : OK 時に { quantity, kcal } を渡す
//   onClose        : 閉じる
//
// 設計判断:
//   - kcal は整数のみ。 quantity は小数点 1 個まで許可。
//   - トグル切替時に値の換算はしない。 PRIVEAT の数量 / kcal は独立フィールド扱い
//     (現状 portion セグメントが kcal スケーリングを担っているので、 ここで換算すると
//      二重制御になる)。

const KEYS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['back', '0', '.'],
]

const MAX_LEN = 7

const appendDigit = (current, ch, allowDecimal) => {
  if (current.length >= MAX_LEN) return current
  if (ch === '.') {
    if (!allowDecimal) return current
    if (current.includes('.')) return current
    if (current === '') return '0.'
    return current + '.'
  }
  if (current === '0') return ch
  return current + ch
}

const removeLast = (current) => {
  if (!current) return ''
  return current.slice(0, -1)
}

export default function NumericKeypadModal({
  visible,
  title = '分量・カロリー',
  subtitle,
  initialMode = 'quantity',
  quantityValue = '',
  quantityUnit = '',
  kcalValue = '',
  perUnitKcal,
  allowToggle = true,
  onSubmit,
  onClose,
}) {
  const [mode, setMode] = useState(initialMode)
  const [qtyDraft, setQtyDraft] = useState(String(quantityValue ?? ''))
  const [kcalDraft, setKcalDraft] = useState(String(kcalValue ?? ''))

  // visible が立ち上がる瞬間に props で渡された値で再初期化する。
  // 親側で値が更新されてもモーダルを開き直さない限り反映しない (編集中の打鍵保護)。
  // deps は意図的に visible のみ。
  useEffect(() => {
    if (visible) {
      setMode(initialMode)
      setQtyDraft(String(quantityValue ?? ''))
      setKcalDraft(String(kcalValue ?? ''))
    }
  }, [visible]) // eslint-disable-line

  const current = mode === 'quantity' ? qtyDraft : kcalDraft
  const setCurrent = (next) => {
    if (mode === 'quantity') setQtyDraft(next)
    else setKcalDraft(next)
  }
  const unitLabel = mode === 'quantity' ? quantityUnit || '' : 'kcal'
  const allowDecimal = mode === 'quantity'

  const handleKey = (k) => {
    if (k === 'back') setCurrent(removeLast(current))
    else setCurrent(appendDigit(current, k, allowDecimal))
  }
  const handleToggle = () => {
    if (!allowToggle) return
    setMode((m) => (m === 'quantity' ? 'kcal' : 'quantity'))
  }
  const handleOk = () => {
    onSubmit?.({ quantity: qtyDraft, kcal: kcalDraft })
  }

  const hintLabel =
    perUnitKcal == null
      ? null
      : quantityUnit
        ? `1${quantityUnit} / ${perUnitKcal}kcal`
        : `1単位 / ${perUnitKcal}kcal`

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerSide} />
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} style={styles.headerSide}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.valueRow}>
            <View style={styles.subtitleWrap}>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View style={styles.valueBox}>
              <Text style={styles.valueText} numberOfLines={1}>
                {current === '' ? '0' : current}
              </Text>
              {unitLabel ? <Text style={styles.unitText}>{unitLabel}</Text> : null}
            </View>
          </View>

          {hintLabel ? (
            <View style={styles.hintBanner}>
              <View style={styles.hintLabelChip}>
                <Text style={styles.hintLabelChipText}>分量の目安</Text>
              </View>
              <Text style={styles.hintText}>{hintLabel}</Text>
            </View>
          ) : null}

          <View style={styles.keypad}>
            {KEYS.map((row, i) => (
              <View
                key={i}
                style={[styles.keypadRow, i < KEYS.length - 1 && styles.keypadRowDivider]}
              >
                {row.map((k) => {
                  const disabled = k === '.' && !allowDecimal
                  return (
                    <Pressable
                      key={k}
                      onPress={() => handleKey(k)}
                      disabled={disabled}
                      style={({ pressed }) => [
                        styles.key,
                        pressed && styles.keyPressed,
                        disabled && styles.keyDisabled,
                      ]}
                    >
                      <Text style={styles.keyText}>{k === 'back' ? '⌫' : k}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            {allowToggle ? (
              <Pressable
                onPress={handleToggle}
                style={({ pressed }) => [styles.toggleBtn, pressed && styles.btnPressed]}
              >
                <Text style={styles.toggleBtnText}>
                  {mode === 'quantity' ? 'カロリーで入力' : '分量で入力'}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.flex1} />
            )}
            <Pressable
              onPress={handleOk}
              style={({ pressed }) => [styles.okBtn, pressed && styles.btnPressed]}
            >
              <Text style={styles.okBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerSide: { width: 32, alignItems: 'center', justifyContent: 'center' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.large,
    fontWeight: '600',
    color: colors.darkPurple,
  },
  closeText: {
    fontSize: 24,
    color: colors.gray,
    fontWeight: '300',
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fafafe',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    minHeight: 56,
  },
  subtitleWrap: { flex: 1, paddingRight: 8 },
  subtitle: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
  },
  valueBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  valueText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.darkPurple,
    marginRight: 6,
  },
  unitText: {
    fontSize: fontSize.middle,
    color: colors.gray,
  },
  hintBanner: {
    backgroundColor: colors.lightPurple,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  hintLabelChip: {
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 4,
  },
  hintLabelChipText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.darkPurple,
  },
  hintText: {
    fontSize: fontSize.middle,
    fontWeight: '600',
    color: colors.white,
  },
  keypad: { marginBottom: 12 },
  keypadRow: { flexDirection: 'row' },
  keypadRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.grayFifth,
  },
  key: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: { backgroundColor: colors.lightGrayPurple },
  keyDisabled: { opacity: 0.25 },
  keyText: {
    fontSize: 24,
    fontWeight: '500',
    color: colors.darkPurple,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.lightPurple,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnText: {
    fontSize: fontSize.middle,
    fontWeight: '600',
    color: colors.lightPurple,
  },
  okBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.lightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  okBtnText: {
    fontSize: fontSize.middle,
    fontWeight: '600',
    color: colors.white,
  },
  btnPressed: { opacity: 0.7 },
})
