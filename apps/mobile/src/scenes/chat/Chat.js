import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Bubble, GiftedChat, InputToolbar, Message, MessageText, Send } from 'react-native-gifted-chat'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import { useActiveLLM, useActiveModel } from '../../state/modelContext'
import { buildCoachingContext } from '../../coaching/context'
import { buildCoachSystemPrompt } from '../../coaching/prompts'
import * as Haptics from 'expo-haptics'
import { useActionSheet } from '@expo/react-native-action-sheet'
import FontIcon from 'react-native-vector-icons/FontAwesome'
import ScreenTemplate from '../../components/ScreenTemplate'
import { colors, fontSize } from '../../theme'
import FoodCard from './FoodCard'
import { getFoodSchemaPrompt, normalizePortion, parseFoodOutput } from './schema'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import { countFoodLog, insertFoodLogFromLabel, insertFoodLogItems } from '../../db/foodLog'
import { insertCoachExchange } from '../../db/chatMessages'
import { captureFromCamera, pickFromLibrary, runOcr } from './imageOcr'
import { detectAndParse } from './ocrParsers'
import { insertEnergyFromFitness, insertProductFromLabel, insertWeightFromOcr } from '../../db/ocrLogs'
import LabelRecordCard from './LabelRecordCard'

const USER = { _id: 1 }
const ASSISTANT = { _id: 2, name: 'AI' }

// コーチング応答などの AI 自由発言はマークダウン形式で出ることが多いので
// EnrichedMarkdownText で描画する。Bubble の left 背景（薄グレー）の上に置かれる。
const MARKDOWN_STYLE = {
  paragraph: { color: colors.black, fontSize: fontSize.middle, marginTop: 0, marginBottom: 6 },
  h1: { color: colors.darkPurple, fontSize: 20, fontWeight: '700', marginTop: 4, marginBottom: 6 },
  h2: { color: colors.darkPurple, fontSize: 18, fontWeight: '700', marginTop: 4, marginBottom: 6 },
  h3: { color: colors.darkPurple, fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
  list: { color: colors.black, fontSize: fontSize.middle, marginBottom: 6, bulletColor: colors.lightPurple },
  blockquote: { color: colors.darkPurple, borderColor: colors.lightPurple, borderWidth: 3, backgroundColor: 'transparent' },
  codeBlock: {
    color: colors.darkPurple,
    fontFamily: 'Courier',
    backgroundColor: '#efedf7',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  code: { color: colors.darkPurple, backgroundColor: '#efedf7', fontFamily: 'Courier' },
  strong: { color: colors.darkPurple },
  link: { color: colors.lightPurple, underline: true },
}

const renderAssistantMarkdown = (textProps) => {
  const msg = textProps.currentMessage
  const isAssistant = msg?.user?._id === ASSISTANT._id
  const text = (msg?.text ?? '').trim()
  // 自分の発言・空メッセージはデフォルトの MessageText（リンク認識・コピー等の挙動を維持）
  if (!isAssistant || !text) return <MessageText {...textProps} />
  return (
    <View style={chatMarkdownStyles.wrap}>
      <EnrichedMarkdownText
        markdown={text}
        markdownStyle={MARKDOWN_STYLE}
        flavor="github"
        allowTrailingMargin={false}
        selectable
      />
    </View>
  )
}

const chatMarkdownStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
})

// Message の親 View にかかっているデフォルト maxWidth: '70%' を 90% に広げる。
// 食品カードもマークダウン応答も横幅を活かせるようにするため。
const WIDE_BUBBLE_CONTAINER = {
  left: { maxWidth: '90%' },
  right: { maxWidth: '90%' },
}
const renderWideMessage = (props) => (
  <Message {...props} containerStyle={WIDE_BUBBLE_CONTAINER} />
)

const COACH_SUGGESTIONS = [
  '今週どうだった？',
  '今日の調子は？',
  '何を意識すべき？',
  '炭水化物多すぎる？',
  'もう少し痩せるには？',
  '体重の傾向は？',
]

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

// ラベル OCR の結果は LabelRecordCard で表示するため、IMessage にラベル情報を載せる。
//   products には先に保存済み (productId が振られている)、food_log への登録はユーザー入力待ち。
const makeLabelRecordMessage = (productId, ocrData) => {
  const stamp = Date.now()
  return {
    _id: `local-label-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    labelRecord: {
      productId,
      perUnit: {
        kcal: ocrData.kcal ?? null,
        protein: ocrData.protein ?? null,
        fat: ocrData.fat ?? null,
        carb: ocrData.carb ?? null,
        salt: ocrData.salt ?? null,
      },
    },
  }
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

// コーチ応答の生テキストから <think>...</think> を除去（Qwen3 系で稀に出力される）。
// ストリーミング途中で未閉じの場合は think 後の文字列を返す（思考中表示を回避）。
const stripThink = (text) => {
  if (!text) return ''
  let out = String(text).replace(/<think>[\s\S]*?<\/think>/g, '')
  // 開きタグだけ残っている場合は丸ごと隠す
  const open = out.indexOf('<think>')
  if (open >= 0) out = out.slice(0, open)
  return out.trim()
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
  const {
    activeModel,
    currentRole,
    setCurrentRole,
    fellBack,
    dismissFellBack,
  } = useActiveModel()
  // llm インスタンスは LLMProvider が起動時から保持しているグローバルなもの。
  // mode 切替 → setCurrentRole で Provider 側でモデル swap が起き、
  // llm.isReady が false → true へ遷移する。Chat 側はこの遷移を購読して configure する。
  const llm = useActiveLLM()

  // 前回のロード未完了が検出された場合、ユーザーに通知
  useEffect(() => {
    if (fellBack) {
      Alert.alert(
        'モデルを切り戻しました',
        '前回のモデルロードが完了しませんでした（メモリ不足の可能性）。安全のため軽量モデル（0.6B）に切り戻しました。\n\n別のモデルを使う場合は「設定 > LLM モデル」から再選択してください。',
        [{ text: 'OK', onPress: dismissFellBack }],
      )
    }
  }, [fellBack, dismissFellBack])
  const [localMessages, setLocalMessages] = useState([])
  const [llmCards, setLlmCards] = useState({}) // { historyIndex: { foodItems? | error? } }
  const [ocrBusy, setOcrBusy] = useState(false)
  const [mode, setMode] = useState('log') // 'log' | 'coach'
  const [inputText, setInputText] = useState('')
  // モード別に messageHistory / llmCards のスナップショットを保持。
  // モード切替時に「現在モード→保存」「新モード→復元」して configure に渡す。
  const logHistoryRef = useRef([])
  const coachHistoryRef = useRef([])
  const logCardsRef = useRef({})
  const [modeBusy, setModeBusy] = useState(false)
  const llmTimestampsRef = useRef([])
  const { showActionSheetWithOptions } = useActionSheet()

  // mode と llm.isReady の両方を依存にした configure。
  //   - 初回マウント: mode='log', isReady=true → parser systemPrompt を投入
  //   - モード切替時: handleSetMode が setMode + setCurrentRole(swap) を呼ぶ
  //     → モデルが swap される間 isReady=false → swap 完了で isReady=true
  //     → この useEffect が走り、新モードに合った systemPrompt + 復元履歴で configure
  //   - 同じモデルを parser/coach に設定している場合は swap が走らないが、
  //     mode 依存だけで再走するので configure はちゃんと当たる
  // modeBusy のクリアもここで行う（swap 完了＋configure 完了が揃ったら解除）。
  useEffect(() => {
    if (!llm.isReady) return
    let cancelled = false
    ;(async () => {
      try {
        const restoreHist =
          mode === 'log' ? logHistoryRef.current : coachHistoryRef.current
        let systemPrompt
        let temperature
        if (mode === 'coach') {
          const context = await buildCoachingContext()
          if (cancelled) return
          systemPrompt = buildCoachSystemPrompt(context)
          temperature = 0.5
        } else {
          systemPrompt = buildSystemPrompt()
          temperature = 0.2
        }
        llm.configure({
          chatConfig: { systemPrompt, initialMessageHistory: restoreHist },
          generationConfig: { temperature },
        })
        // インデックスが復元履歴に合わせて変わるので、processed/persisted セットも合わせる。
        // 復元される assistant 行は既に処理 (log なら parse、coach なら DB 保存) 済み扱い。
        const newProcessed = new Set()
        const newPersisted = new Set()
        restoreHist.forEach((m, i) => {
          if (m.role === 'assistant') {
            newProcessed.add(i)
            newPersisted.add(i)
          }
        })
        processedRef.current = newProcessed
        persistedCoachRef.current = newPersisted
      } catch (e) {
        console.warn('[chat] configure failed:', e)
      } finally {
        if (!cancelled) setModeBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llm.isReady, mode])

  // Parse any complete assistant messages that haven't been parsed yet
  // (uses processedRef to guard against re-processing in the async window)
  const processedRef = useRef(new Set())
  // coach モードで「DB 保存済み」の assistant 行 index を追跡。
  // 二重保存を防ぐ。configure useEffect で復元時にもリセットされる。
  const persistedCoachRef = useRef(new Set())
  useEffect(() => {
    if (llm.isGenerating) return
    // コーチモードでは現在の履歴はすべてコーチ応答（プレーンテキスト表示のみ）。
    // パース処理はスキップ。
    if (mode === 'coach') return
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    base.forEach((m, idx) => {
      if (m.role !== 'assistant') return
      if (processedRef.current.has(idx)) return
      processedRef.current.add(idx)
      ;(async () => {
        const userMsg = base[idx - 1]?.content
        console.log('========== Chat log ==========')
        console.log('[model]', activeModel.id)
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
  }, [llm.messageHistory, llm.isGenerating, mode])

  // coach モードの Q&A を chat_messages テーブルに永続化。
  //   - 記録モードの会話は food_log が成果物として残るので保存しない。
  //   - DayDetail の「この日のコーチ対話」セクションで日付別に取り出して表示する。
  useEffect(() => {
    if (llm.isGenerating) return
    if (mode !== 'coach') return
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    base.forEach((m, idx) => {
      if (m.role !== 'assistant') return
      if (persistedCoachRef.current.has(idx)) return
      const userMsg = base[idx - 1]
      if (userMsg?.role !== 'user') return
      const cleanedAssistant = stripThink(m.content)
      if (!cleanedAssistant) return // <think> しか出てこなかった等は保存しない
      persistedCoachRef.current.add(idx)
      insertCoachExchange({
        userText: userMsg.content,
        assistantText: cleanedAssistant,
        modelId: activeModel.id,
      }).catch((e) => console.warn('[chat] coach persist failed:', e?.message ?? e))
    })
  }, [llm.messageHistory, llm.isGenerating, mode, activeModel.id])

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
      // assistant: 現在のモードで描画方法を決定
      //   coach → ストリーミング中もプレーンテキストで逐次表示
      //   log   → パース結果（カード or エラー）を表示
      if (mode === 'coach') {
        const cleaned = stripThink(m.content)
        if (cleaned.length > 0) {
          items.push({ _id: `h-${i}`, text: cleaned, createdAt, user: ASSISTANT })
        }
        return
      }
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
  }, [llm.messageHistory, llmCards, localMessages, mode])

  // モード切り替え: 現在モードのスナップショットを ref に保存し、mode + currentRole を更新。
  // configure 自体は上の useEffect が isReady の遷移を待って実行する。
  //   - parser ⇄ coach のモデルが異なる場合: setCurrentRole → Provider が swap → 数秒待ち
  //   - 同じモデルの場合: swap なし、mode 依存だけで configure が再走
  // modeBusy は configure useEffect の最後で false に戻る。
  const handleSetMode = useCallback(
    async (newMode) => {
      if (newMode === mode || llm.isGenerating || modeBusy) return
      // swap 中（isReady=false）に切替を許してしまうと configure useEffect が
      // 2 回走って後の方が古い履歴で上書きする恐れがあるため、ready 前は弾く。
      if (!llm.isReady) return
      setModeBusy(true)
      try {
        const currentHist = llm.messageHistory.filter((m) => m.role !== 'system')
        // 現在モードを保存
        if (mode === 'log') {
          logHistoryRef.current = currentHist
          logCardsRef.current = llmCards
        } else {
          coachHistoryRef.current = currentHist
        }
        const restoreCards = newMode === 'log' ? logCardsRef.current : {}
        setLlmCards(restoreCards)
        setInputText('')
        setMode(newMode)
        // ロール切替 → Provider 側で必要ならモデル swap
        const targetRole = newMode === 'coach' ? 'coach' : 'parser'
        if (currentRole !== targetRole) {
          await setCurrentRole(targetRole)
        }
        // setModeBusy(false) は configure useEffect 内で
      } catch (e) {
        console.warn('[chat] mode switch failed:', e)
        setModeBusy(false)
      }
    },
    [mode, llm, llmCards, modeBusy, currentRole, setCurrentRole],
  )

  const onSend = useCallback(
    async (sent) => {
      if (!sent.length) return
      const text = sent[0].text
      setInputText('')
      if (text.trim() === '/card') {
        setLocalMessages((prev) => [...prev, makeUserMessage(text), makeDummyCardMessage()])
        return
      }
      if (!llm.isReady || llm.isGenerating) return

      // コーチモードのみ、毎回最新の DB コンテキストで再 configure（履歴は維持）。
      if (mode === 'coach') {
        try {
          const preservedHistory = llm.messageHistory.filter((m) => m.role !== 'system')
          const context = await buildCoachingContext()
          llm.configure({
            chatConfig: {
              systemPrompt: buildCoachSystemPrompt(context),
              initialMessageHistory: preservedHistory,
            },
            generationConfig: { temperature: 0.5 },
          })
        } catch (e) {
          console.warn('[coach] context build failed:', e)
        }
      }
      llm.sendMessage(text)
    },
    [llm, mode],
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

      if (parsed.kind === 'label') {
        // ラベル: 食品名がラベルには無いことが多いのでカード型に出してユーザー入力を待つ。
        // products には先に保存しておき、card 側で food_log INSERT 時に productId で紐付ける。
        const id = await insertProductFromLabel(parsed, { imageUri: uri })
        console.log('=========================')
        setLocalMessages((prev) => [...prev, makeLabelRecordMessage(id, parsed)])
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        return
      }

      let resultText
      if (parsed.kind === 'fitness') {
        const id = await insertEnergyFromFitness(parsed, { imageUri: uri })
        resultText = formatFitnessResult(parsed, id)
      } else if (parsed.kind === 'weight') {
        const id = await insertWeightFromOcr(parsed, { imageUri: uri })
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

  // ラベル OCR カードの「食事として記録」ハンドラ。
  //   productId / perUnit はカード側から渡してもらう (localMessages を依存にしない)。
  const handleLabelSave = useCallback(
    async (messageId, { name, quantity, unit, productId, perUnit }) => {
      const id = await insertFoodLogFromLabel({
        productId,
        name,
        quantity,
        unit,
        perUnit,
      })
      const totalKcal =
        perUnit?.kcal != null ? Math.round(perUnit.kcal * quantity) : null
      const summary = `${name} ${quantity}${unit}${
        totalKcal != null ? ` · ${totalKcal} kcal` : ''
      }`
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? {
                ...m,
                labelRecord: {
                  ...m.labelRecord,
                  savedFoodLogId: id,
                  savedSummary: summary,
                },
              }
            : m,
        ),
      )
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [],
  )

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
      if (current?.labelRecord) {
        return <LabelRecordCard message={current} onSave={handleLabelSave} />
      }
      return <Bubble {...props} renderMessageText={renderAssistantMarkdown} />
    },
    [updateFoodItem, handleLabelSave],
  )

  const renderChatEmpty = useCallback(
    () => {
      if (mode === 'coach') {
        return (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              あなたの記録（食事・運動・体重）をもとに、コーチが日本語で答えます。
            </Text>
            <Text style={styles.captionText}>下の質問例から選ぶか、自由に入力してください。</Text>
            <Text style={styles.captionText}>※ 医療的な判断はしません。</Text>
          </View>
        )
      }
      return (
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
      )
    },
    [mode],
  )

  // GiftedChat 内蔵 Composer は内部で lineHeight: 22 を設定するうえ、react-native-gesture-handler の
  // TextInput を使っている。これが Android で日本語 IME 未確定文字の下線を消す原因になるため、
  // 素の react-native TextInput で同等機能を再現する。
  const renderComposer = useCallback((props) => {
    const tiProps = props.textInputProps ?? {}
    const { style: extraStyle, onChangeText: extOnChangeText, ...restTextInputProps } = tiProps

    const handleChangeText = (txt) => {
      extOnChangeText?.(txt)
      props.onTextChanged?.(txt)
    }
    const handleContentSizeChange = (e) => {
      const { contentSize } = e.nativeEvent
      props.onInputSizeChanged?.({ width: contentSize.width, height: contentSize.height })
    }
    return (
      <TextInput
        {...restTextInputProps}
        multiline
        underlineColorAndroid="transparent"
        enablesReturnKeyAutomatically
        placeholder={props.placeholder}
        placeholderTextColor={tiProps.placeholderTextColor ?? colors.gray}
        value={props.text}
        onChangeText={handleChangeText}
        onContentSizeChange={handleContentSizeChange}
        style={[
          styles.composerInput,
          { height: props.composerHeight },
          extraStyle,
        ]}
      />
    )
  }, [])

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
          <Text style={styles.note}>初回のみ。{activeModel.label}</Text>
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
        text={inputText}
        placeholder={mode === 'coach' ? 'コーチに質問する（例: 今週どうだった？）' : '食べたものを入力'}
        isTyping={llm.isGenerating}
        minComposerHeight={48}
        renderMessage={renderWideMessage}
        renderBubble={renderBubble}
        renderActions={renderActions}
        renderAvatar={null}
        renderChatEmpty={renderChatEmpty}
        renderInputToolbar={(props) => (
          <View>
            {mode === 'coach' && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.suggestionRow}
              >
                {COACH_SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    onPress={() => setInputText(s)}
                    style={styles.suggestionChip}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.suggestionText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.modeBar}>
              <TouchableOpacity
                onPress={() => handleSetMode('log')}
                disabled={modeBusy || llm.isGenerating}
                style={[
                  styles.modeBtn,
                  mode === 'log' && styles.modeBtnActive,
                  (modeBusy || llm.isGenerating) && styles.modeBtnDisabled,
                ]}
                activeOpacity={0.7}
              >
                <FontIcon
                  name="pencil"
                  size={12}
                  color={mode === 'log' ? colors.white : colors.darkPurple}
                />
                <Text style={[styles.modeBtnText, mode === 'log' && styles.modeBtnTextActive]}>
                  記録
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleSetMode('coach')}
                disabled={modeBusy || llm.isGenerating}
                style={[
                  styles.modeBtn,
                  mode === 'coach' && styles.modeBtnActive,
                  (modeBusy || llm.isGenerating) && styles.modeBtnDisabled,
                ]}
                activeOpacity={0.7}
              >
                <FontIcon
                  name="comments-o"
                  size={12}
                  color={mode === 'coach' ? colors.white : colors.darkPurple}
                />
                <Text style={[styles.modeBtnText, mode === 'coach' && styles.modeBtnTextActive]}>
                  コーチに聞く
                </Text>
              </TouchableOpacity>
              {modeBusy && (
                <ActivityIndicator size="small" color={colors.lightPurple} style={{ marginLeft: 8 }} />
              )}
            </View>
            <InputToolbar
              {...props}
              containerStyle={styles.inputToolbar}
              renderComposer={renderComposer}
            />
          </View>
        )}
        textInputProps={{
          editable: !llm.isGenerating,
          placeholderTextColor: colors.gray,
          style: styles.textInput,
          onChangeText: setInputText,
        }}
        renderSend={(props) => {
          const enabled = !!props.text?.trim()
          return (
            <Send {...props} containerStyle={styles.sendContainer} disabled={!enabled}>
              <View style={[styles.sendCircle, !enabled && styles.sendCircleDisabled]}>
                <FontIcon name="chevron-up" size={14} color={colors.white} />
              </View>
            </Send>
          )
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
  modeBar: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f7f6fb',
    borderTopWidth: 1,
    borderTopColor: '#e5e2f0',
    gap: 8,
  },
  modeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#e5e2f0',
  },
  modeBtnActive: {
    backgroundColor: colors.lightPurple,
  },
  modeBtnText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
    marginLeft: 6,
    fontWeight: '600',
  },
  modeBtnTextActive: {
    color: colors.white,
  },
  suggestionRow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: '#fafafe',
    borderTopWidth: 1,
    borderTopColor: '#e5e2f0',
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#dcd9ec',
  },
  suggestionText: {
    fontSize: fontSize.small,
    color: colors.darkPurple,
  },
  sendContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.lightPurple,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCircleDisabled: {
    backgroundColor: '#dcd9ec',
  },
  modeBtnDisabled: {
    opacity: 0.5,
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
  // 自前 Composer 用。lineHeight は意図的に指定しない（Android の IME 未確定下線が消えるため）
  composerInput: {
    flex: 1,
    color: colors.black,
    backgroundColor: colors.white,
    fontSize: fontSize.middle,
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 8,
    textAlignVertical: 'top',
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
