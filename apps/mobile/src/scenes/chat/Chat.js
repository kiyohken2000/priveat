import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Bubble, GiftedChat, InputToolbar } from 'react-native-gifted-chat'
import { useLLM, QWEN3_0_6B_QUANTIZED } from 'react-native-executorch'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'
import FoodCard from './FoodCard'

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

const makeDummyCardMessage = () => {
  const stamp = Date.now()
  return {
    _id: `local-card-${stamp}`,
    text: '',
    createdAt: new Date(stamp),
    user: ASSISTANT,
    foodItems: [
      { id: 'f1', name: 'ごはん', quantity: 150, unit: 'g', portion: 'normal', baseKcal: 252 },
      { id: 'f2', name: 'カツ丼', quantity: 1, unit: '人前', portion: 'normal', baseKcal: 893 },
      { id: 'f3', name: 'みそ汁', quantity: 1, unit: '杯', portion: 'normal', baseKcal: 40 },
    ],
    dailyTotal: { target: 2000 },
  }
}

const makeUserMessage = (text) => {
  const stamp = Date.now()
  return {
    _id: `local-user-${stamp}`,
    text,
    createdAt: new Date(stamp),
    user: USER,
  }
}

export default function Chat() {
  const llm = useLLM({ model: QWEN3_0_6B_QUANTIZED })
  const [localMessages, setLocalMessages] = useState([])
  const llmTimestampsRef = useRef([])

  useEffect(() => {
    if (llm.isReady) {
      llm.configure({ chatConfig: { systemPrompt: SYSTEM_PROMPT } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady])

  const messages = useMemo(() => {
    const items = []
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    const stamps = llmTimestampsRef.current
    while (stamps.length < base.length) {
      const prev = stamps[stamps.length - 1] ?? 0
      stamps.push(Math.max(Date.now(), prev + 1))
    }
    base.forEach((m, i) => {
      items.push({
        _id: `h-${i}`,
        text: m.role === 'assistant' ? stripThink(m.content) : m.content,
        createdAt: new Date(stamps[i]),
        user: m.role === 'user' ? USER : ASSISTANT,
      })
    })
    if (llm.isGenerating) {
      const streamed = stripThink(llm.response)
      if (streamed) {
        items.push({
          _id: 'streaming',
          text: streamed,
          createdAt: new Date(),
          user: ASSISTANT,
        })
      }
    }
    const all = [...items, ...localMessages]
    all.sort((a, b) => a.createdAt - b.createdAt)
    return all.reverse()
  }, [llm.messageHistory, llm.response, llm.isGenerating, localMessages])

  const onSend = useCallback(
    (sent) => {
      if (!sent.length) return
      const text = sent[0].text
      if (text.trim() === '/card') {
        setLocalMessages((prev) => [...prev, makeUserMessage(text), makeDummyCardMessage()])
        return
      }
      if (!llm.isReady || llm.isGenerating) return
      llm.sendMessage(text)
    },
    [llm],
  )

  const updateFoodItem = useCallback((messageId, itemId, updates) => {
    setLocalMessages((prev) =>
      prev.map((m) =>
        m._id === messageId && m.foodItems
          ? {
              ...m,
              foodItems: m.foodItems.map((it) => (it.id === itemId ? { ...it, ...updates } : it)),
            }
          : m,
      ),
    )
  }, [])

  const renderBubble = useCallback(
    (props) => {
      const current = props.currentMessage
      if (current?.foodItems) {
        return <FoodCard message={current} onUpdateItem={updateFoodItem} />
      }
      return <Bubble {...props} />
    },
    [updateFoodItem],
  )

  const renderChatEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>メッセージを送ると AI が応答します。</Text>
        <Text style={styles.emptyHint}>`/card` を送るとサンプル食品カードを表示します。</Text>
      </View>
    ),
    [],
  )

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
        renderBubble={renderBubble}
        renderAvatar={null}
        renderChatEmpty={renderChatEmpty}
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
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    transform: [{ scaleY: -1 }],
  },
  emptyText: {
    fontSize: fontSize.middle,
    color: colors.gray,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 8,
    textAlign: 'center',
  },
})
