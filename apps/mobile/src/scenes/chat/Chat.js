import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Bubble, GiftedChat, InputToolbar } from 'react-native-gifted-chat'
import { QWEN3_0_6B_QUANTIZED, useLLM } from 'react-native-executorch'
import * as Haptics from 'expo-haptics'
import { useActionSheet } from '@expo/react-native-action-sheet'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'
import FoodCard from './FoodCard'
import { getFoodSchemaPrompt, normalizePortion, parseFoodOutput } from './schema'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import { countFoodLog, insertFoodLogItems } from '../../db/foodLog'
import { captureFromCamera, pickFromLibrary, runOcr } from './imageOcr'
import { detectAndParse } from './ocrParsers'
import { insertEnergyFromFitness, insertProductFromLabel, insertWeightFromOcr } from '../../db/ocrLogs'

const USER = { _id: 1 }
const ASSISTANT = { _id: 2, name: 'AI' }

const PARSER_SYSTEM_PROMPT = `あなたは食事の記述を構造化データに変換するパーサーです。
ユーザーが日本語で書いた食事内容を、食品ごとに分解してJSONで出力してください。

ルール:
- 各食品について name（食品名）, quantity（数量）, unit（単位）を抽出する
- name は一般的な表記に正規化する
- ユーザーが書いた数量はそのままの数値を使う（200g なら quantity=200, unit="g"。途中で桁を削らない）
- 数量や単位は、それが書かれている品目だけに付ける（他の品目に勝手にコピーしない）
- 単位は g / 個 / 本 / 杯 / 枚 / 切 / 缶 / 袋 / 人前 など自然なものを選ぶ
- 「大盛り」「少なめ」などのニュアンスは portion に入れる（書かれている品目だけ）
- カロリーや栄養素は推定しない
- 数量も単位もどちらも書かれていない品目だけ quantity=1, unit="人前" にする
- 食品を含まない入力は items を空配列 [] にする

ユーザーへの返答はしない。JSONだけを返すこと。`

const FEW_SHOT_EXAMPLES = `以下の例を参考にしてください:

入力: 食パン1枚とゆで卵2個
出力: {"items":[{"name":"食パン","quantity":1,"unit":"枚"},{"name":"ゆで卵","quantity":2,"unit":"個"}]}

入力: ささみ200gとブロッコリー100g
出力: {"items":[{"name":"ささみ","quantity":200,"unit":"g"},{"name":"ブロッコリー","quantity":100,"unit":"g"}]}

入力: ごはん大盛りと焼き魚
出力: {"items":[{"name":"ごはん","quantity":1,"unit":"杯","portion":"大盛り"},{"name":"焼き魚","quantity":1,"unit":"切"}]}

入力: お腹すいた
出力: {"items":[]}`

const buildSystemPrompt = () =>
  `${PARSER_SYSTEM_PROMPT}\n${getFoodSchemaPrompt()}\n${FEW_SHOT_EXAMPLES}\n/no_think`

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
    isDummy: true,
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

const makeUserImageMessage = (uri) => {
  const stamp = Date.now()
  return {
    _id: `local-img-${stamp}`,
    text: '',
    image: uri,
    createdAt: new Date(stamp),
    user: USER,
  }
}

const makeOcrResultMessage = (text) => {
  const stamp = Date.now()
  return {
    _id: `local-ocr-${stamp}`,
    text: text && text.trim().length > 0 ? text : '（文字を検出できませんでした）',
    createdAt: new Date(stamp + 1), // ensure it sorts after the image
    user: ASSISTANT,
    isOcrResult: true,
  }
}

const formatLabelResult = (data, insertedId) => {
  const lines = ['【ラベル読取】']
  if (data.kcal != null) lines.push(`エネルギー  ${data.kcal} kcal`)
  if (data.protein != null) lines.push(`たんぱく質  ${data.protein} g`)
  if (data.fat != null) lines.push(`脂質        ${data.fat} g`)
  if (data.carb != null) lines.push(`炭水化物    ${data.carb} g`)
  if (data.salt != null) lines.push(`食塩相当量  ${data.salt} g`)
  lines.push(`→ products に保存しました (#${insertedId})`)
  return lines.join('\n')
}

const formatFitnessResult = (data, insertedId) => {
  const lines = ['【フィットネス読取】']
  if (data.activeKcal != null) lines.push(`消費カロリー  ${data.activeKcal} kcal`)
  if (data.steps != null) lines.push(`歩数          ${data.steps.toLocaleString()}`)
  if (data.distance != null) lines.push(`距離          ${data.distance} km`)
  lines.push(`→ energy_log に保存しました (#${insertedId})`)
  return lines.join('\n')
}

const formatWeightResult = (data, insertedId) => {
  const lines = ['【体重読取】']
  lines.push(`最新  ${data.latest} kg`)
  if (data.weights.length > 1) {
    lines.push(`履歴  ${data.weights.slice(0, 8).map((w) => `${w}`).join(' / ')}${data.weights.length > 8 ? ' ...' : ''} kg`)
  }
  lines.push(`→ weight_log に保存しました (#${insertedId})`)
  return lines.join('\n')
}

const parseAndEnrich = async (content, idx) => {
  try {
    const parsed = parseFoodOutput(content)
    const enriched = await Promise.all(
      parsed.items.map(async (it, j) => {
        const matched = await findBestFood(it.name).catch((err) => {
          console.warn('[db] search failed for', it.name, err)
          return null
        })
        const computedKcal = computeKcalFromMatch(matched, it.quantity, it.unit, it.name)
        return {
          id: `${idx}-${j}`,
          name: it.name,
          quantity: it.quantity,
          unit: it.unit,
          portion: normalizePortion(it.portion),
          baseKcal: computedKcal,
          matchedName: matched?.name ?? null,
          matchedFoodCode: matched?.food_code ?? null,
          matchedFoodId: matched?.id ?? null,
        }
      }),
    )
    return { foodItems: enriched }
  } catch (e) {
    return { error: e?.message ?? String(e) }
  }
}

export default function Chat() {
  const llm = useLLM({ model: QWEN3_0_6B_QUANTIZED })
  const [localMessages, setLocalMessages] = useState([])
  const [llmCards, setLlmCards] = useState({}) // { historyIndex: { foodItems? | error? } }
  const [ocrBusy, setOcrBusy] = useState(false)
  const llmTimestampsRef = useRef([])
  const { showActionSheetWithOptions } = useActionSheet()

  // Configure LLM as a structured-output parser once it's ready
  useEffect(() => {
    if (llm.isReady) {
      llm.configure({
        chatConfig: { systemPrompt: buildSystemPrompt() },
        generationConfig: { temperature: 0.2 },
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady])

  // Parse any complete assistant messages that haven't been parsed yet
  // (uses processedRef to guard against re-processing in the async window)
  const processedRef = useRef(new Set())
  useEffect(() => {
    if (llm.isGenerating) return
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    base.forEach((m, idx) => {
      if (m.role !== 'assistant') return
      if (processedRef.current.has(idx)) return
      processedRef.current.add(idx)
      ;(async () => {
        const userMsg = base[idx - 1]?.content
        console.log('========== Chat log ==========')
        if (userMsg) console.log('[USER]', userMsg)
        console.log('[LLM raw]', m.content)
        const result = await parseAndEnrich(m.content, idx)
        if (result.foodItems) {
          console.log('[parsed+enriched]', JSON.stringify(result.foodItems, null, 2))
          try {
            const insertedIds = await insertFoodLogItems(result.foodItems)
            const total = await countFoodLog()
            console.log(`[food_log] inserted ${insertedIds.length} rows (total ${total})`, insertedIds)
          } catch (e) {
            console.warn('[food_log] insert failed:', e?.message ?? e)
          }
        } else {
          console.log('[parse error]', result.error)
        }
        console.log('==============================')
        setLlmCards((prev) => ({ ...prev, [idx]: result }))
        // AI 応答が画面に出るタイミングでハプティック。成功 / 失敗で振動を出し分け。
        Haptics.notificationAsync(
          result.error
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success,
        ).catch(() => {})
      })()
    })
  }, [llm.messageHistory, llm.isGenerating])

  const messages = useMemo(() => {
    const items = []
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    const stamps = llmTimestampsRef.current
    while (stamps.length < base.length) {
      const prev = stamps[stamps.length - 1] ?? 0
      stamps.push(Math.max(Date.now(), prev + 1))
    }
    base.forEach((m, i) => {
      const createdAt = new Date(stamps[i])
      if (m.role === 'user') {
        items.push({ _id: `h-${i}`, text: m.content, createdAt, user: USER })
        return
      }
      // assistant
      const card = llmCards[i]
      if (card?.foodItems) {
        items.push({
          _id: `h-${i}`,
          text: '',
          createdAt,
          user: ASSISTANT,
          foodItems: card.foodItems,
        })
      } else if (card?.error) {
        items.push({
          _id: `h-${i}`,
          text: '食品を抽出できませんでした。もう少し具体的に書いてみてください。',
          createdAt,
          user: ASSISTANT,
          isError: true,
        })
      }
      // else: parse pending — show nothing yet (isTyping covers the gap)
    })
    const all = [...items, ...localMessages]
    all.sort((a, b) => a.createdAt - b.createdAt)
    return all.reverse()
  }, [llm.messageHistory, llmCards, localMessages])

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

  // 画像 → OCR → 振り分け → 保存 → 結果表示 の共通ハンドラ。
  const handleImage = useCallback(async (picker) => {
    if (ocrBusy) return
    try {
      const uri = await picker()
      if (!uri) return
      setOcrBusy(true)
      setLocalMessages((prev) => [...prev, makeUserImageMessage(uri)])
      console.log('========== OCR ==========')
      console.log('[image]', uri)
      const ocr = await runOcr(uri)
      const rawText = ocr?.text ?? ''
      console.log('[ocr text]', rawText)
      const parsed = detectAndParse(rawText)
      console.log('[ocr parsed]', parsed)

      let resultText
      if (parsed.kind === 'label') {
        const id = await insertProductFromLabel(parsed)
        resultText = formatLabelResult(parsed, id)
      } else if (parsed.kind === 'fitness') {
        const id = await insertEnergyFromFitness(parsed)
        resultText = formatFitnessResult(parsed, id)
      } else if (parsed.kind === 'weight') {
        const id = await insertWeightFromOcr(parsed)
        resultText = formatWeightResult(parsed, id)
      } else {
        // 振り分け失敗時は生テキストをそのまま表示（手入力フォールバックの足がかり）
        resultText = `判定できませんでした。読み取った全文:\n\n${rawText.slice(0, 500)}`
      }
      console.log('=========================')

      setLocalMessages((prev) => [...prev, makeOcrResultMessage(resultText)])
      Haptics.notificationAsync(
        parsed.kind === 'unknown'
          ? Haptics.NotificationFeedbackType.Warning
          : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {})
    } catch (e) {
      console.warn('[ocr] failed:', e?.message ?? e)
      setLocalMessages((prev) => [
        ...prev,
        makeOcrResultMessage(`エラー: ${e?.message ?? e}`),
      ])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
    } finally {
      setOcrBusy(false)
    }
  }, [ocrBusy])

  const onPressAttach = useCallback(() => {
    if (ocrBusy) return
    const options = ['カメラで撮影', 'ライブラリから選択', 'キャンセル']
    const cancelButtonIndex = 2
    showActionSheetWithOptions(
      { options, cancelButtonIndex, title: '画像を読み取る' },
      (selectedIndex) => {
        if (selectedIndex === 0) handleImage(captureFromCamera)
        else if (selectedIndex === 1) handleImage(pickFromLibrary)
      },
    )
  }, [showActionSheetWithOptions, handleImage, ocrBusy])

  const renderActions = useCallback(
    () => (
      <TouchableOpacity
        style={styles.attachButton}
        onPress={onPressAttach}
        disabled={ocrBusy}
        activeOpacity={0.7}
      >
        {ocrBusy ? (
          <ActivityIndicator size="small" color={colors.lightPurple} />
        ) : (
          <FontIcon name="camera" size={22} color={colors.lightPurple} />
        )}
      </TouchableOpacity>
    ),
    [onPressAttach, ocrBusy],
  )

  const updateFoodItem = useCallback((messageId, itemId, updates) => {
    if (messageId.startsWith('local-card-')) {
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
      return
    }
    if (messageId.startsWith('h-')) {
      const idx = Number(messageId.slice(2))
      setLlmCards((prev) => {
        const entry = prev[idx]
        if (!entry?.foodItems) return prev
        return {
          ...prev,
          [idx]: {
            ...entry,
            foodItems: entry.foodItems.map((it) => (it.id === itemId ? { ...it, ...updates } : it)),
          },
        }
      })
    }
  }, [])

  const renderBubble = useCallback(
    (props) => {
      const current = props.currentMessage
      if (current?.foodItems) {
        return (
          <FoodCard
            message={current}
            onUpdateItem={updateFoodItem}
            title={current.isDummy ? '食品カード（ダミー）' : '抽出された食品'}
          />
        )
      }
      return <Bubble {...props} />
    },
    [updateFoodItem],
  )

  const renderChatEmpty = useCallback(
    () => (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>食べたものを送ると、自動で分解してカードにします。</Text>

        <Text style={styles.sectionLabel}>おすすめの書き方（精度が高い）</Text>
        <View style={styles.exampleBlock}>
          <Text style={styles.exampleLine}>・プレーンヨーグルト200g</Text>
          <Text style={styles.exampleLine}>・リンゴ1個</Text>
          <Text style={styles.exampleLine}>・コーヒー1杯</Text>
        </View>
        <Text style={styles.captionText}>1行に1品ずつ、改行で区切ると最も正確です。</Text>

        <Text style={styles.sectionLabel}>簡単な書き方（短文）</Text>
        <View style={styles.exampleBlock}>
          <Text style={styles.exampleLine}>カツ丼と缶チューハイ2本</Text>
          <Text style={styles.exampleLine}>ごはん大盛りと焼き魚</Text>
        </View>
        <Text style={styles.captionText}>「〜と〜」でつないでも OK。短いほど精度が上がります。</Text>

        <Text style={styles.sectionLabel}>コツ</Text>
        <Text style={styles.captionText}>・数量と単位を書く（例: 食パン1枚、缶チューハイ2本、ささみ200g）</Text>
        <Text style={styles.captionText}>・「大盛り」「少なめ」などのニュアンスも書ける</Text>

        <Text style={styles.emptyHintDev}>（開発用）`/card` でサンプル食品カードを表示</Text>
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
        isTyping={llm.isGenerating}
        minComposerHeight={48}
        renderBubble={renderBubble}
        renderActions={renderActions}
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
  attachButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    color: colors.black,
    backgroundColor: colors.white,
    fontSize: fontSize.middle,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    transform: [{ scaleY: -1 }],
  },
  emptyText: {
    fontSize: fontSize.middle,
    color: colors.darkPurple,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 18,
  },
  sectionLabel: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  exampleBlock: {
    backgroundColor: colors.lightGrayPurple,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'stretch',
  },
  exampleLine: {
    fontSize: fontSize.small,
    color: colors.black,
    lineHeight: 20,
  },
  captionText: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 6,
  },
  emptyHintDev: {
    fontSize: fontSize.small,
    color: colors.gray,
    marginTop: 20,
    textAlign: 'center',
    fontStyle: 'italic',
  },
})
