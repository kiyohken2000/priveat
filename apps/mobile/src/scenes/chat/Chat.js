import React, { useRef, useState, useEffect } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLLM, QWEN3_0_6B_QUANTIZED } from 'react-native-executorch'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'

const SYSTEM_PROMPT = `あなたは日本語で簡潔に答えるアシスタントです。
推論プロセスは出力せず、答えだけを返してください。
/no_think`

const stripThink = (text) => {
  if (!text) return text
  let out = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '')
  const openIdx = out.indexOf('<think>')
  if (openIdx >= 0) out = out.slice(0, openIdx)
  return out
}

export default function Chat() {
  const llm = useLLM({ model: QWEN3_0_6B_QUANTIZED })
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (llm.isReady) {
      llm.configure({ chatConfig: { systemPrompt: SYSTEM_PROMPT } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady])

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [llm.messageHistory.length, llm.response])

  const onSend = () => {
    const text = input.trim()
    if (!text || !llm.isReady || llm.isGenerating) return
    setInput('')
    llm.sendMessage(text)
  }

  if (llm.error) {
    return (
      <ScreenTemplate>
        <View style={styles.center}>
          <Text style={styles.title}>エラー</Text>
          <Text style={styles.errorText}>{String(llm.error.message ?? llm.error)}</Text>
        </View>
      </ScreenTemplate>
    )
  }

  if (!llm.isReady) {
    const pct = Math.round((llm.downloadProgress ?? 0) * 100)
    const downloading = pct > 0 && pct < 100
    return (
      <ScreenTemplate>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.lightPurple} />
          <Text style={styles.title}>
            {downloading ? 'モデルをダウンロード中' : 'モデルをロード中'}
          </Text>
          {downloading && <Text style={styles.subtitle}>{pct}%</Text>}
          <Text style={styles.note}>初回のみ。Qwen3-0.6B（量子化版）</Text>
        </View>
      </ScreenTemplate>
    )
  }

  return (
    <ScreenTemplate>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messages}
        >
          {llm.messageHistory.length === 0 && !llm.isGenerating && (
            <Text style={styles.placeholder}>
              プロンプトを送ってモデルの応答を確認します。
            </Text>
          )}
          {llm.messageHistory.map((m, i) => (
            <View
              key={`${i}-${m.role}`}
              style={[
                styles.bubble,
                m.role === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  m.role === 'user' && styles.userBubbleText,
                ]}
              >
                {m.role === 'assistant' ? stripThink(m.content) : m.content}
              </Text>
            </View>
          ))}
          {llm.isGenerating && (
            <View style={[styles.bubble, styles.assistantBubble]}>
              <Text style={styles.bubbleText}>{stripThink(llm.response) || '考え中…'}</Text>
            </View>
          )}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="メッセージを入力"
            placeholderTextColor={colors.gray}
            editable={!llm.isGenerating}
            multiline
          />
          {llm.isGenerating ? (
            <TouchableOpacity style={styles.stopButton} onPress={llm.interrupt}>
              <Text style={styles.sendLabel}>停止</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, !input.trim() && styles.sendDisabled]}
              onPress={onSend}
              disabled={!input.trim()}
            >
              <Text style={styles.sendLabel}>送信</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </ScreenTemplate>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: fontSize.xLarge,
    fontWeight: '700',
    marginTop: 16,
    color: colors.darkPurple,
  },
  subtitle: {
    fontSize: fontSize.large,
    marginTop: 8,
    color: colors.darkPurple,
  },
  note: {
    fontSize: fontSize.small,
    marginTop: 12,
    color: colors.gray,
  },
  errorText: {
    fontSize: fontSize.middle,
    marginTop: 12,
    color: colors.redPrimary,
    textAlign: 'center',
  },
  messages: {
    padding: 16,
    paddingBottom: 24,
  },
  placeholder: {
    fontSize: fontSize.middle,
    color: colors.gray,
    textAlign: 'center',
    marginTop: 24,
  },
  bubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.lightPurple,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.graySixth,
  },
  bubbleText: {
    fontSize: fontSize.middle,
    color: colors.black,
  },
  userBubbleText: {
    color: colors.white,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.grayFifth,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: fontSize.middle,
    color: colors.black,
    backgroundColor: colors.graySixth,
    borderRadius: 20,
  },
  sendButton: {
    marginLeft: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.darkPurple,
  },
  sendDisabled: {
    backgroundColor: colors.grayFourth,
  },
  stopButton: {
    marginLeft: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.redSecondary,
  },
  sendLabel: {
    color: colors.white,
    fontSize: fontSize.middle,
    fontWeight: '600',
  },
})
