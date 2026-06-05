import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { colors, fontSize } from '../../theme'
import { getStance, setStance, STANCE_MAX_LENGTH } from '../../coaching/stance'

// テンプレチップ。タップでカーソル位置に挿入され、ユーザーが書き始めやすくする。
// 文章そのものは穴埋め型ではなく完成された例文にして、不要部分を削れば済むようにする。
const TEMPLATES = [
  {
    label: '基本情報',
    body: `【基本情報】
- 年齢: ○歳 / 身長: ○cm / 体重: ○kg
- 体型の悩み: お腹周りが気になる など`,
  },
  {
    label: '目標',
    body: `【目標】
- 無理せず緩やかな減量・健康維持
- ○kg台を維持し、体型を引き締めたい`,
  },
  {
    label: '運動習慣',
    body: `【運動習慣】
- 毎日ランニング約○km
- Apple Watch の活動量込みで収支を見たい`,
  },
  {
    label: 'アドバイス方針',
    body: `【アドバイス方針】
- 厳しい減量より体型改善を重視
- 否定的な指摘よりも前向きな提案を希望
- 改善案は1つに絞ってシンプルに`,
  },
  {
    label: '制約・好み',
    body: `【制約・好み】
- 苦手な食材: ○○
- 食べたら気分が下がる食材: ○○
- お菓子を食べても総摂取と総消費で判断してほしい`,
  },
]

export default function StanceScreen() {
  const [text, setText] = useState('')
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const v = await getStance()
      if (cancelled) return
      setText(v)
      setSelection({ start: v.length, end: v.length })
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // カーソル位置にテンプレを差し込む。前後に必要な空行を自動で補う。
  const insertTemplate = useCallback(
    (template) => {
      const start = Math.min(selection.start, text.length)
      const end = Math.min(selection.end, text.length)
      const before = text.slice(0, start)
      const after = text.slice(end)

      // 前後に空行を挟む（既にあれば追加しない）
      let prefix = ''
      if (before.length > 0) {
        if (before.endsWith('\n\n')) prefix = ''
        else if (before.endsWith('\n')) prefix = '\n'
        else prefix = '\n\n'
      }
      let suffix = ''
      if (after.length > 0) {
        if (after.startsWith('\n\n')) suffix = ''
        else if (after.startsWith('\n')) suffix = '\n'
        else suffix = '\n\n'
      }

      const inserted = `${prefix}${template}${suffix}`
      const next = before + inserted + after
      if (next.length > STANCE_MAX_LENGTH) {
        Alert.alert('文字数オーバー', `${STANCE_MAX_LENGTH} 文字を超えるため挿入できません。`)
        return
      }
      setText(next)
      const caret = (before + inserted).length
      setSelection({ start: caret, end: caret })
      // フォーカス戻す（チップタップで外れているため）
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [text, selection],
  )

  const onChangeText = useCallback((v) => {
    if (v.length > STANCE_MAX_LENGTH) {
      setText(v.slice(0, STANCE_MAX_LENGTH))
      return
    }
    setText(v)
  }, [])

  const onSave = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await setStance(text)
      Alert.alert('保存しました', 'コーチに渡す指示を更新しました。')
    } catch (e) {
      Alert.alert('保存エラー', e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, text])

  const onClear = useCallback(() => {
    if (!text) return
    Alert.alert('クリア', '入力中の内容を消去します。よろしいですか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'クリア',
        style: 'destructive',
        onPress: () => {
          setText('')
          setSelection({ start: 0, end: 0 })
        },
      },
    ])
  }, [text])

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.root}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.desc}>
          コーチへの指示・スタンスを自由文で入力できます。目標、運動習慣、アドバイスの傾向などを書いておくと、コーチの応答に反映されます。
        </Text>

        <Text style={styles.sectionLabel}>テンプレート（タップで挿入）</Text>
        <View style={styles.chipRow}>
          {TEMPLATES.map((t) => (
            <Pressable
              key={t.label}
              onPress={() => insertTemplate(t.body)}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            >
              <Text style={styles.chipText}>+ {t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.inputBox}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onChangeText}
            multiline
            placeholder="例：39歳、169cm。無理せず緩やかな減量を目指しています。毎日8km走っているので Apple Watch の活動量も込みで判断してください。否定的なトーンは避けて、改善案は1つに絞ってほしいです。"
            placeholderTextColor={colors.gray}
            selection={selection}
            onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
            style={styles.input}
            scrollEnabled={false}
            editable={loaded}
          />
          <Text style={styles.counter}>
            {text.length} / {STANCE_MAX_LENGTH}
          </Text>
        </View>

        <Pressable
          onPress={onSave}
          disabled={busy || !loaded}
          style={({ pressed }) => [
            styles.saveBtn,
            (pressed || busy || !loaded) && styles.saveBtnPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>保存</Text>
          )}
        </Pressable>

        <Pressable
          onPress={onClear}
          disabled={!text}
          style={({ pressed }) => [
            styles.clearBtn,
            (pressed || !text) && styles.clearBtnPressed,
          ]}
        >
          <Text style={[styles.clearBtnText, !text && { opacity: 0.4 }]}>クリア</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.white },
  root: { padding: 20, paddingBottom: 60 },
  desc: {
    fontSize: fontSize.middle,
    color: colors.gray,
    marginBottom: 18,
    lineHeight: 20,
  },
  sectionLabel: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#f4f3fb',
    borderWidth: 1,
    borderColor: '#e2dff0',
  },
  chipPressed: { opacity: 0.7 },
  chipText: { fontSize: fontSize.small, color: colors.darkPurple },
  inputBox: { marginBottom: 12 },
  input: {
    minHeight: 200,
    borderWidth: 1,
    borderColor: '#dcd9ec',
    borderRadius: 10,
    padding: 12,
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    backgroundColor: '#fafafe',
    textAlignVertical: 'top',
    // 注意: lineHeight を指定すると Android で IME 未確定文字の下線が消えるため指定しない
  },
  counter: {
    fontSize: fontSize.small,
    color: colors.gray,
    textAlign: 'right',
    marginTop: 4,
  },
  saveBtn: {
    backgroundColor: colors.lightPurple,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  saveBtnPressed: { opacity: 0.7 },
  saveBtnText: { color: colors.white, fontSize: fontSize.middle, fontWeight: '600' },
  clearBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  clearBtnPressed: { opacity: 0.5 },
  clearBtnText: { color: colors.gray, fontSize: fontSize.small },
})
