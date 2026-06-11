import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors, fontSize } from '../theme'

// あすけん風の数値入力モーダル。 OS 標準キーボードを使わずに自作テンキーで
// 数量 / kcal を 1 画面で打てるようにする。 トグルで 「数量」 と 「kcal」 の
// どちらに入力中かを切り替える。
//
// kcal の自動換算 (perUnitKcal):
//   - perUnitKcal prop が来ているか、 quantity + kcal の初期値から計算できれば、
//     1 単位あたりの kcal を内部状態で持って auto-scale する。
//   - quantity を編集すると kcal = round(quantity × perUnitKcal) で自動更新。
//   - kcal を編集すると perUnitKcal = kcal / quantity に更新される (ヒントもこれに追随)。
//   - perUnitKcal が無いケース (数量も kcal も未入力 等) はトグルで独立フィールド扱い。
//
// Props:
//   visible        : 表示制御
//   title          : ヘッダタイトル (デフォルト '分量・カロリー')
//   subtitle       : 食品名等の補助表示
//   initialMode    : 'quantity' | 'kcal' (起動時のモード)
//   quantityValue  : 数量の初期値 (string)
//   quantityUnit   : 数量の単位ラベル ('杯', '個', 'g' 等)
//   unitSuggestions: 単位チップ候補 (省略時はチップ非表示)。 quantity モードでだけ出す。
//                    タップで現在単位を切替え、 onSubmit で unit / unitTouched を返す。
//                    単位が変わると perUnit (1 単位あたり kcal) は意味を失うのでクリアする
//                    (例: 杯 → 個 で 1杯200kcal を 1個200kcal とは扱わない)。
//   kcalValue      : kcal の初期値 (string)
//   perUnitKcal    : 1 単位あたりの kcal (省略時は quantity+kcal から派生を試みる)
//   allowToggle    : モード切替ボタンを出すか (デフォルト true)
//   onSubmit       : OK 時に { quantity, kcal, unit, ... } を渡す
//   onClose        : 閉じる

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

const derivePerUnit = (qtyStr, kcalStr, propPerUnit) => {
  if (propPerUnit != null) {
    const n = Number(propPerUnit)
    if (!Number.isNaN(n) && n > 0) return n
  }
  const q = parseFloat(String(qtyStr ?? ''))
  const k = parseFloat(String(kcalStr ?? ''))
  if (Number.isFinite(q) && q > 0 && Number.isFinite(k) && k >= 0) return k / q
  return null
}

export default function NumericKeypadModal({
  visible,
  title = '分量・カロリー',
  subtitle,
  initialMode = 'quantity',
  quantityValue = '',
  quantityUnit = '',
  unitSuggestions,
  kcalValue = '',
  perUnitKcal,
  allowToggle = true,
  onSubmit,
  onClose,
}) {
  const [mode, setMode] = useState(initialMode)
  const [qtyDraft, setQtyDraft] = useState(String(quantityValue ?? ''))
  const [kcalDraft, setKcalDraft] = useState(String(kcalValue ?? ''))
  // 単位は props から初期化して内部で編集可能にする (チップ選択用)。
  const [unitDraft, setUnitDraft] = useState(String(quantityUnit ?? ''))
  // 内部状態の 1 単位あたり kcal。 quantity 編集 → kcal 自動更新、
  // kcal 編集 → perUnit を再算出、 という双方向リンクを担う。
  const initialPerUnit = useMemo(
    () => derivePerUnit(quantityValue, kcalValue, perUnitKcal),
    [visible], // eslint-disable-line
  )
  const [perUnit, setPerUnit] = useState(initialPerUnit)
  // どのモードで打鍵が起きたかを追う。 kcalTouched=true なら呼び元側で
  // kcalSource='manual' を立てる根拠になる (auto-scale だけで変わった kcal は除外したい)。
  const [qtyTouched, setQtyTouched] = useState(false)
  const [kcalTouched, setKcalTouched] = useState(false)
  const [unitTouched, setUnitTouched] = useState(false)

  // visible が立ち上がる瞬間に props で渡された値で再初期化する。
  // 親側で値が更新されてもモーダルを開き直さない限り反映しない (編集中の打鍵保護)。
  // deps は意図的に visible のみ。
  useEffect(() => {
    if (visible) {
      setMode(initialMode)
      setQtyDraft(String(quantityValue ?? ''))
      setKcalDraft(String(kcalValue ?? ''))
      setUnitDraft(String(quantityUnit ?? ''))
      setPerUnit(derivePerUnit(quantityValue, kcalValue, perUnitKcal))
      setQtyTouched(false)
      setKcalTouched(false)
      setUnitTouched(false)
    }
  }, [visible]) // eslint-disable-line

  const current = mode === 'quantity' ? qtyDraft : kcalDraft
  const unitLabel = mode === 'quantity' ? unitDraft || '' : 'kcal'
  const allowDecimal = mode === 'quantity'

  // 単位チップタップ。 単位を切り替えると 1 単位あたり kcal の関係が壊れるので
  // perUnit をクリアし、 以後の quantity 編集で kcal を自動スケールしないようにする。
  const handlePickUnit = (u) => {
    if (u === unitDraft) return
    setUnitDraft(u)
    setUnitTouched(true)
    setPerUnit(null)
  }

  const handleKey = (k) => {
    if (mode === 'quantity') {
      const next = k === 'back' ? removeLast(qtyDraft) : appendDigit(qtyDraft, k, true)
      setQtyDraft(next)
      setQtyTouched(true)
      // 1 単位 kcal がわかっていれば数量編集に応じて kcal を自動再計算。
      // 空文字 (= 数量未入力) は 0 ではなく空のままにする (kcal 表示も空)。
      if (perUnit != null) {
        if (next === '') {
          setKcalDraft('')
        } else {
          const q = parseFloat(next)
          if (Number.isFinite(q)) {
            setKcalDraft(String(Math.max(0, Math.round(q * perUnit))))
          }
        }
      }
    } else {
      const next = k === 'back' ? removeLast(kcalDraft) : appendDigit(kcalDraft, k, false)
      setKcalDraft(next)
      setKcalTouched(true)
      // kcal を手で打ち変えたら、 現在の数量で割って perUnit を再算出する。
      // 結果として hint バナーも追従し、 次に数量を弄った時の換算基準が更新される。
      if (next !== '' && qtyDraft !== '') {
        const q = parseFloat(qtyDraft)
        const kk = parseFloat(next)
        if (Number.isFinite(q) && q > 0 && Number.isFinite(kk) && kk >= 0) {
          setPerUnit(kk / q)
        }
      }
    }
  }
  const handleToggle = () => {
    if (!allowToggle) return
    setMode((m) => (m === 'quantity' ? 'kcal' : 'quantity'))
  }
  const handleOk = () => {
    onSubmit?.({
      quantity: qtyDraft,
      kcal: kcalDraft,
      unit: unitDraft,
      quantityTouched: qtyTouched,
      kcalTouched,
      unitTouched,
    })
  }

  const hintLabel = (() => {
    if (perUnit == null) return null
    const rounded = Math.round(perUnit)
    return unitDraft
      ? `1${unitDraft} / ${rounded}kcal`
      : `1単位 / ${rounded}kcal`
  })()

  const showUnitChips =
    mode === 'quantity' && Array.isArray(unitSuggestions) && unitSuggestions.length > 0

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

          {showUnitChips ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.unitChipsRow}
            >
              {unitSuggestions.map((u) => {
                const selected = unitDraft === u
                return (
                  <Pressable
                    key={u}
                    onPress={() => handlePickUnit(u)}
                    style={({ pressed }) => [
                      styles.unitChip,
                      selected && styles.unitChipSelected,
                      pressed && styles.unitChipPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.unitChipText,
                        selected && styles.unitChipTextSelected,
                      ]}
                    >
                      {u}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>
          ) : null}

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
  unitChipsRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingRight: 8,
    gap: 6,
    marginBottom: 8,
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    backgroundColor: colors.white,
  },
  unitChipSelected: {
    backgroundColor: colors.lightPurple,
    borderColor: colors.lightPurple,
  },
  unitChipPressed: { opacity: 0.6 },
  unitChipText: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
  },
  unitChipTextSelected: { color: colors.white },
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
