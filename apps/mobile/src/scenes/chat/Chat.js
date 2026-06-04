import React, { useEffect, useMemo } from 'react'
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { GiftedChat, InputToolbar } from 'react-native-gifted-chat'
import { useLLM, QWEN3_0_6B_QUANTIZED } from 'react-native-executorch'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'

const USER = { _id: 1 }
const ASSISTANT = { _id: 2, name: 'AI' }

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

  useEffect(() => {
    if (llm.isReady) {
      llm.configure({ chatConfig: { systemPrompt: SYSTEM_PROMPT } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady])

  const messages = useMemo(() => {
    const items = []
    const now = Date.now()
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    base.forEach((m, i) => {
      items.push({
        _id: `h-${i}`,
        text: m.role === 'assistant' ? stripThink(m.content) : m.content,
        createdAt: new Date(now - (base.length - i) * 1000),
        user: m.role === 'user' ? USER : ASSISTANT,
      })
    })
    if (llm.isGenerating) {
      const streamed = stripThink(llm.response)
      if (streamed) {
        items.push({
          _id: 'streaming',
          text: streamed,
          createdAt: new Date(now),
          user: ASSISTANT,
        })
      }
    }
    return items.reverse()
  }, [llm.messageHistory, llm.response, llm.isGenerating])

  const onSend = (sent) => {
    if (!sent.length || !llm.isReady || llm.isGenerating) return
    llm.sendMessage(sent[0].text)
  }

  if (llm.error) {
    return (
      <ScreenTemplate>
        <View style={styles.center}>
          <Text style={styles.title}>エラー</Text>
          <Text style={styles.errorText}>
            {String(llm.error.message ?? llm.error)}
          </Text>
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
    <View style={styles.chatRoot}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.white} />
      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={USER}
        placeholder="メッセージを入力"
        isTyping={llm.isGenerating && !llm.response}
        minComposerHeight={48}
        renderInputToolbar={(props) => (
          <InputToolbar
            {...props}
            containerStyle={styles.inputToolbar}
          />
        )}
        textInputProps={{
          editable: !llm.isGenerating,
          placeholderTextColor: colors.gray,
          style: styles.textInput,
        }}
        alwaysShowSend
      />
    </View>
  )
}

const styles = StyleSheet.create({
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
  chatRoot: {
    flex: 1,
    backgroundColor: colors.white,
  },
  inputToolbar: {
    backgroundColor: colors.white,
    borderTopColor: colors.grayFifth,
  },
  textInput: {
    color: colors.black,
    backgroundColor: colors.white,
    fontSize: fontSize.middle,
  },
})
