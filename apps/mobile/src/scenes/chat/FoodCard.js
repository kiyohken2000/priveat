import React, { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import FoodNameInput from '../../components/FoodNameInput'
import NumericKeypadModal from '../../components/NumericKeypadModal'

// チャットの数量編集モーダル内で出す単位チップ。 EditFoodScreen と同じ並び。
const UNIT_SUGGESTIONS = ['杯', '個', '枚', '本', '玉', '皿', '食', 'g', 'ml']

const itemKcal = (item) => (item?.kcal != null ? Math.round(item.kcal) : null)

function FoodRow({ item, kcal, messageId, onUpdateItem, onDeleteItem }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.name ?? '')
  // 数値テンキー モーダル: open かどうか + 起動時のフォーカス対象 ('quantity' | 'kcal')。
  const [keypad, setKeypad] = useState({ open: false, mode: 'quantity' })

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

  const openKeypad = (mode) => setKeypad({ open: true, mode })
  const closeKeypad = () => setKeypad((s) => ({ ...s, open: false }))

  // テンキーモーダル確定。
  //   - quantity / kcal は 1 単位あたり kcal を介して双方向リンク済 (モーダル内部で計算済)。
  //   - kcalTouched=true なら 「ユーザーが kcal を直接編集」 と判断して
  //     kcalSource='manual' を立てる。 quantity だけ動かして kcal が自動換算で
  //     変わったケースでは source を維持する (db / llm_estimate のまま)。
  //   - unitTouched=true なら patch.unit に新しい単位を載せる。 親 (Chat.updateFoodItem)
  //     で DB と UI を更新する。 単位だけ変えて kcal を再計算するロジックは現状無し
  //     (kcal はそのまま据え置き)。 必要なら同じモーダルで kcal を手入力すればよい。
  const onKeypadSubmit = ({ quantity: qNext, kcal: kNext, unit: uNext, kcalTouched, unitTouched }) => {
    const patch = {}
    const qNumNext = qNext === '' ? null : parseFloat(qNext)
    const qCurrent = item.quantity ?? null
    if (qNext === '' && qCurrent != null) {
      patch.quantity = null
    } else if (qNumNext != null && !Number.isNaN(qNumNext) && qNumNext !== qCurrent) {
      patch.quantity = qNumNext
    }
    const kNumNext = kNext === '' ? null : parseInt(kNext, 10)
    const kCurrent = kcal ?? null
    if (kNumNext == null && kCurrent != null) {
      patch.kcal = null
      if (kcalTouched) patch.kcalSource = null
    } else if (kNumNext != null && !Number.isNaN(kNumNext) && kNumNext !== kCurrent) {
      patch.kcal = kNumNext
      if (kcalTouched) patch.kcalSource = 'manual'
    }
    if (unitTouched) {
      const uCurrent = item.unit ?? ''
      const uNextStr = (uNext ?? '').trim()
      if (uNextStr !== uCurrent) {
        patch.unit = uNextStr || null
      }
    }
    if (Object.keys(patch).length > 0) {
      onUpdateItem?.(messageId, item.id, patch)
    }
    closeKeypad()
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        {editing ? (
          <FoodNameInput
            style={styles.nameInput}
            value={draft}
            onChangeText={setDraft}
            onCommit={(picked, food) => {
              setDraft(picked)
              setEditing(false)
              if (picked && picked !== item.name) {
                // picked food (foods 行) を patch に載せて parent 側で
                // findBestFood top-1 上書きを回避させる。
                // ユーザーがサジェストで指したまさにその食品で kcal 計算される。
                onUpdateItem?.(messageId, item.id, { name: picked, matchedFood: food })
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
        <View style={styles.detailRow}>
          <Pressable
            onPress={() => openKeypad('quantity')}
            hitSlop={6}
            style={({ pressed }) => pressed && styles.detailPressed}
          >
            <Text style={[styles.detail, styles.detailTappable]}>
              {item.quantity ?? '—'}
              {item.unit ?? ''}
            </Text>
          </Pressable>
          <Text style={styles.detail}> · </Text>
          <Pressable
            onPress={() => openKeypad('kcal')}
            hitSlop={6}
            style={({ pressed }) => pressed && styles.detailPressed}
          >
            <Text style={[styles.detail, styles.detailTappable]}>
              {kcal == null ? '— kcal' : `${kcal} kcal`}
              {kcal != null && item.kcalSource === 'llm_estimate' ? (
                <Text style={styles.estimateBadge}>（推定）</Text>
              ) : null}
            </Text>
          </Pressable>
        </View>
        {item.matchedName ? (
          <Text style={styles.matched} numberOfLines={1}>
            ※ {item.matchedName}
          </Text>
        ) : null}
      </View>
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
      <NumericKeypadModal
        visible={keypad.open}
        subtitle={item.name || undefined}
        initialMode={keypad.mode}
        quantityValue={item.quantity != null ? String(item.quantity) : ''}
        quantityUnit={item.unit ?? ''}
        unitSuggestions={UNIT_SUGGESTIONS}
        kcalValue={kcal != null ? String(kcal) : ''}
        onSubmit={onKeypadSubmit}
        onClose={closeKeypad}
      />
    </View>
  )
}

export default function FoodCard({
  message,
  onUpdateItem,
  onDeleteItem,
  onEstimateMissing,
  estimating,
  estimatingPhase, // 'swapping' | 'generating' | null
  title,
}) {
  const items = message.foodItems ?? []
  const kcals = items.map(itemKcal)
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
      {hasUnknownKcal && onEstimateMissing ? (
        <TouchableOpacity
          style={[styles.estimateBtn, estimating && styles.estimateBtnBusy]}
          onPress={() => onEstimateMissing(message._id)}
          disabled={!!estimating}
          activeOpacity={0.7}
        >
          {estimating ? (
            <View style={styles.estimateBtnInner}>
              <ActivityIndicator size="small" color={colors.white} />
              <Text style={styles.estimateBtnTextBusy}>
                {estimatingPhase === 'swapping'
                  ? 'コーチモデル読み込み中…'
                  : 'AI で推定中…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.estimateBtnText}>「— kcal」の品目を AI で推定</Text>
          )}
        </TouchableOpacity>
      ) : null}
      <Text style={styles.hint}>料理名 / 数量 / kcal タップで編集 / × で削除</Text>
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
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  // タップで開けることをほんのり示すため、 数量 / kcal だけ薄い下線を入れる。
  detailTappable: {
    textDecorationLine: 'underline',
    textDecorationColor: colors.grayFourth,
  },
  detailPressed: { opacity: 0.5 },
  matched: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    marginTop: 2,
    opacity: 0.7,
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
  estimateBadge: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
    opacity: 0.85,
  },
  estimateBtn: {
    marginTop: 8,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.darkPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  estimateBtnBusy: {
    opacity: 0.7,
  },
  estimateBtnText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
  },
  estimateBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  estimateBtnTextBusy: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
    marginLeft: 8,
  },
})
