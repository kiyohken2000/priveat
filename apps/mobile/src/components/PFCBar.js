import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, fontSize } from '../theme'

// 栄養バランス (Protein / Fat / Carb) を g とカロリー比率の積み上げバーで表示する。
//
// 入力:
//   macros = { totalKcal, matchedKcal, protein, fat, carb } (g 単位、いずれも >= 0)
//
// 表示:
//   - P / F / C それぞれの g (整数)
//   - カロリー寄与の比率バー (P:4kcal/g, F:9kcal/g, C:4kcal/g)
//   - 栄養素データが取れた kcal が全体の半分未満の場合は警告を出す
//     (ref_food_id が無い OCR 入力やマッチ失敗が多いと精度が落ちるため)

const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 }

const round = (n) => Math.round(n ?? 0)

export default function PFCBar({ macros, compact = false }) {
  if (!macros) return null
  const { totalKcal, matchedKcal, protein, fat, carb } = macros
  const hasData = matchedKcal > 0
  const pKcal = protein * KCAL_PER_G.protein
  const fKcal = fat * KCAL_PER_G.fat
  const cKcal = carb * KCAL_PER_G.carb
  const sum = pKcal + fKcal + cKcal
  const pPct = sum > 0 ? (pKcal / sum) * 100 : 0
  const fPct = sum > 0 ? (fKcal / sum) * 100 : 0
  const cPct = sum > 0 ? (cKcal / sum) * 100 : 0

  const coverage = totalKcal > 0 ? Math.round((matchedKcal / totalKcal) * 100) : 0
  const lowCoverage = totalKcal > 0 && coverage < 50

  return (
    <View>
      {!compact && <Text style={styles.title}>栄養バランス</Text>}
      {hasData ? (
        <>
          <View style={styles.barTrack}>
            {pPct > 0 && <View style={[styles.barSeg, styles.pSeg, { flex: pPct }]} />}
            {fPct > 0 && <View style={[styles.barSeg, styles.fSeg, { flex: fPct }]} />}
            {cPct > 0 && <View style={[styles.barSeg, styles.cSeg, { flex: cPct }]} />}
          </View>
          <View style={styles.legendRow}>
            <Legend color={SEG_COLOR.p} label="P" grams={round(protein)} pct={Math.round(pPct)} />
            <Legend color={SEG_COLOR.f} label="F" grams={round(fat)} pct={Math.round(fPct)} />
            <Legend color={SEG_COLOR.c} label="C" grams={round(carb)} pct={Math.round(cPct)} />
          </View>
          {lowCoverage && (
            <Text style={styles.warning}>
              ※ 栄養素データは {coverage}% ({round(matchedKcal)}/{round(totalKcal)} kcal) のみ
            </Text>
          )}
        </>
      ) : (
        <Text style={styles.placeholder}>
          {totalKcal > 0
            ? '栄養素データが取れた食品がありません'
            : 'まだ記録がありません'}
        </Text>
      )}
    </View>
  )
}

const Legend = ({ color, label, grams, pct }) => (
  <View style={styles.legendItem}>
    <View style={[styles.legendDot, { backgroundColor: color }]} />
    <Text style={styles.legendLabel}>{label}</Text>
    <Text style={styles.legendValue}>
      {grams}g
      <Text style={styles.legendPct}> ({pct}%)</Text>
    </Text>
  </View>
)

const SEG_COLOR = {
  p: '#7e57c2', // P=紫 (purple)
  f: '#f29c4a', // F=橙
  c: '#4caf95', // C=緑
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.middle,
    fontWeight: '700',
    color: colors.darkPurple,
    marginBottom: 8,
  },
  barTrack: {
    flexDirection: 'row',
    height: 12,
    backgroundColor: '#e5e2f0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barSeg: { height: '100%' },
  pSeg: { backgroundColor: SEG_COLOR.p },
  fSeg: { backgroundColor: SEG_COLOR.f },
  cSeg: { backgroundColor: SEG_COLOR.c },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '700',
    marginRight: 2,
  },
  legendValue: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
  },
  legendPct: {
    fontSize: 10,
    color: colors.gray,
  },
  placeholder: {
    fontSize: fontSize.small,
    color: colors.gray,
    paddingVertical: 4,
  },
  warning: {
    fontSize: 10,
    color: colors.gray,
    marginTop: 6,
    fontStyle: 'italic',
  },
})
