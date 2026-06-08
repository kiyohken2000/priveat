import React, { useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'

// kind='recipe' のパースとマッチ後に Chat.js が組み立てる recipeData の形:
//   {
//     name: string,
//     servings: number,
//     ingredients: [{
//       id, name, quantity, unit,
//       kcal: number | null,        // computeKcalFromMatch で算出 (1材料あたり)
//       matchedFoodId: number | null,
//       matchedName: string | null, // 「※ 牛ひき肉」のような出典表示
//       kcalSource: 'db' | 'llm_estimate' | null,
//     }],
//     hasUnknownKcal: boolean,      // どれか kcal=null があれば「AI 推定」ボタンを出す
//     saved: boolean,
//     savedRecipeId: number | null,
//   }

function IngredientRow({ ing, onChangeQuantity, onDelete, disabled }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.name}>{ing.name}</Text>
        <View style={styles.qtyLine}>
          <TextInput
            style={styles.qtyInput}
            value={ing.quantity != null ? String(ing.quantity) : ''}
            onChangeText={(v) => onChangeQuantity(ing.id, v)}
            keyboardType="decimal-pad"
            editable={!disabled}
          />
          <Text style={styles.unitText}>
            {ing.unit} · {ing.kcal == null ? '— kcal' : `${ing.kcal} kcal`}
            {ing.kcal != null && ing.kcalSource === 'llm_estimate' ? (
              <Text style={styles.estimateBadge}>（推定）</Text>
            ) : null}
          </Text>
        </View>
        {ing.matchedName ? (
          <Text style={styles.matched} numberOfLines={1}>
            ※ {ing.matchedName}
          </Text>
        ) : null}
      </View>
      {disabled ? null : (
        <TouchableOpacity
          onPress={() => onDelete(ing.id)}
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

export default function RecipeCard({
  message,
  onChangeServings,
  onChangeIngredientQuantity,
  onDeleteIngredient,
  onSave,
  onEstimateMissing,
  estimating,
  estimatingPhase,
  saving,
}) {
  const recipe = message.recipe ?? {}
  const ingredients = recipe.ingredients ?? []
  const [servingsDraft, setServingsDraft] = useState(String(recipe.servings ?? 1))

  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = Math.floor(screenWidth * 0.85)

  const totalKcal = ingredients.reduce((sum, ing) => sum + (ing.kcal ?? 0), 0)
  const hasUnknownKcal = ingredients.some((ing) => ing.kcal == null)
  const srv = Number(servingsDraft)
  const validServings = Number.isFinite(srv) && srv > 0
  const kcalPerServing =
    !hasUnknownKcal && validServings ? Math.round(totalKcal / srv) : null

  const saved = !!recipe.saved
  const disabled = saved || !!saving

  const commitServings = () => {
    const n = Number(servingsDraft)
    if (!Number.isFinite(n) || n <= 0) {
      setServingsDraft(String(recipe.servings ?? 1))
      return
    }
    if (n !== recipe.servings && onChangeServings) {
      onChangeServings(message._id, n)
    }
  }

  if (ingredients.length === 0) {
    return (
      <View style={[styles.card, { width: cardWidth }]}>
        <Text style={styles.title}>レシピ登録: {recipe.name ?? '(無題)'}</Text>
        <Text style={styles.emptyHint}>すべての材料を削除しました</Text>
      </View>
    )
  }

  return (
    <View style={[styles.card, { width: cardWidth }]}>
      <Text style={styles.title}>
        レシピ登録: {recipe.name ?? '(無題)'}
        {saved ? ' ✓ 保存済み' : ''}
      </Text>
      {message.truncated ? (
        <Text style={styles.warn}>
          ※ AI の出力が途中で切れた可能性があります。材料の取りこぼしがあれば追加で入力してください。
        </Text>
      ) : null}

      <View style={styles.servingsLine}>
        <Text style={styles.servingsLabel}>食数</Text>
        <TextInput
          style={styles.servingsInput}
          value={servingsDraft}
          onChangeText={setServingsDraft}
          onBlur={commitServings}
          keyboardType="decimal-pad"
          editable={!disabled}
        />
        <Text style={styles.servingsUnit}>食分</Text>
      </View>

      {ingredients.map((ing) => (
        <IngredientRow
          key={ing.id}
          ing={ing}
          onChangeQuantity={(id, v) =>
            onChangeIngredientQuantity?.(message._id, id, v)
          }
          onDelete={(id) => onDeleteIngredient?.(message._id, id)}
          disabled={disabled}
        />
      ))}

      <View style={styles.total}>
        <Text style={styles.totalLabel}>1食あたり</Text>
        <Text style={styles.totalValue}>
          {kcalPerServing == null ? '— kcal' : `${kcalPerServing} kcal`}
          {!hasUnknownKcal && validServings ? ` (合計 ${totalKcal} kcal)` : ''}
        </Text>
      </View>

      {hasUnknownKcal && onEstimateMissing && !saved ? (
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
            <Text style={styles.estimateBtnText}>
              「— kcal」の材料を AI で推定
            </Text>
          )}
        </TouchableOpacity>
      ) : null}

      {!saved ? (
        <>
          <TouchableOpacity
            style={[styles.saveBtn, disabled && styles.saveBtnDisabled]}
            onPress={() => onSave?.(message._id)}
            disabled={disabled || hasUnknownKcal || !validServings}
            activeOpacity={0.7}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.saveBtnText}>
                {hasUnknownKcal
                  ? 'すべての kcal を確定してから保存'
                  : !validServings
                    ? '食数を入力してください'
                    : 'このレシピを保存'}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>
            材料ごとの kcal は保存後にレシピ編集画面から修正できます
          </Text>
        </>
      ) : (
        <Text style={styles.savedHint}>
          以後「{recipe.name}1食」などで再利用できます
        </Text>
      )}
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
  servingsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grayFifth,
  },
  servingsLabel: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    fontWeight: '600',
    width: 56,
  },
  servingsInput: {
    flex: 1,
    fontSize: fontSize.middle,
    color: colors.black,
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: colors.darkPurple,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginRight: 6,
  },
  servingsUnit: {
    fontSize: fontSize.small,
    color: colors.gray,
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
  qtyLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  qtyInput: {
    fontSize: fontSize.small,
    color: colors.black,
    borderBottomWidth: 1,
    borderBottomColor: colors.darkPurple,
    paddingVertical: 0,
    paddingHorizontal: 0,
    minWidth: 48,
    marginRight: 6,
  },
  unitText: {
    fontSize: fontSize.small,
    color: colors.gray,
  },
  matched: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    marginTop: 2,
    opacity: 0.7,
  },
  estimateBadge: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '600',
    opacity: 0.85,
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
  estimateBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  estimateBtnText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
  },
  estimateBtnTextBusy: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '600',
    marginLeft: 8,
  },
  saveBtn: {
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.lightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: fontSize.small,
    color: colors.white,
    fontWeight: '700',
  },
  savedHint: {
    marginTop: 8,
    fontSize: fontSize.small,
    color: colors.gray,
    textAlign: 'center',
  },
  hint: {
    marginTop: 6,
    fontSize: fontSize.small,
    color: colors.gray,
    textAlign: 'center',
  },
})
