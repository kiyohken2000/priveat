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
import WeightCard from './WeightCard'
import ActivityCard from './ActivityCard'
import UnknownOcrCard from './UnknownOcrCard'
import { getRecordSchemaPrompt, normalizePortion, parseRecordOutput } from './schema'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import {
  countFoodLog,
  deleteFoodLogItem,
  insertFoodLogFromLabel,
  insertFoodLogItems,
  updateFoodLogItem,
} from '../../db/foodLog'
import { insertCoachExchange } from '../../db/chatMessages'
import * as ImageManipulator from 'expo-image-manipulator'
import { captureFromCamera, pickFromLibrary, runOcr } from './imageOcr'
import { getVlmModelById } from '../../data/llmModelsVlm'
import { isVlmModelDownloaded } from '../../services/vlmModelStorage'
import { runWithLlamaRn } from '../../state/vlmOrchestrator'
import { detectAndParse } from './ocrParsers'
import { estimateKcalBatch } from '../../utils/aiKcal'
import { insertEnergyFromFitness, insertEnergyLog, insertProductFromLabel, insertWeightLog } from '../../db/ocrLogs'
import { getLatestWeight } from '../../db/profile'
import { DEFAULT_WEIGHT_KG, estimateActivityKcal } from '../../utils/mets'
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


// 料理写真認識用 (VLM / llama.rn 経路) のプロンプト。
// 出力は「料理名のカンマ区切り」だけを期待。量/カロリーは別途 FoodCard で編集する。
//
// 注: VLM に kcal 推定まで負わせる試行 (#130 後続) は qwen3-vl-2b-q4 では幻覚/フォーマット崩れ/
// 反復ループが頻発したため撤回。料理名抽出のみに専念させ、DB ミス品の kcal は EditFood の
// 「AI推定」ボタン (テキスト LLM = Qwen3-0.6B) で補う運用とする。
const VLM_SYSTEM_PROMPT = `あなたは料理写真を見て「料理名」だけを答えるアシスタントです。

ルール:
- 一般的な日本語の料理名で答える (例: カツ丼、ラーメン、みそ汁)
- 写真に複数の料理が写っていれば、カンマ区切りで列挙
- 料理名以外 (量、kcal、説明、感想) は絶対に書かない
- 判別できなければ「不明」とだけ書く`

const VLM_USER_QUERY = 'この写真の料理名を答えてください。'

// レシート / 注文履歴画面用 (#132 後続) のプロンプト。
//   - OCR を介さず画像のまま VLM に投げ、画面に書かれた商品名/料理名を読み取らせる。
//   - マック注文履歴 / Uber Eats / コンビニレシート画面など、テキスト中心の画面を想定。
//   - 店名/合計金額/支払い方法/受取時間 は無視させる (誤って料理として記録すると食事ログが汚れる)。
//   - 出力フォーマットは料理写真と同じ「カンマ区切り」。下流の parseVlmResponseToItems を共用する。
const VLM_RECEIPT_SYSTEM_PROMPT = `あなたはレシートや注文履歴の画面写真を見て「注文された商品名」だけを答えるアシスタントです。
画面に書かれた文字を読み取り、食品/料理に該当する商品名のみを抽出してください。

ルール:
- 商品名は **日本語表記** で書く (例: ビッグマック、ダブルチーズバーガー、エグチ、ポテトM)
- 同じ商品が英語表記と日本語表記の両方で書かれている場合 (例: "Mac-Fry (L)" と "マックフライポテト(L)") は **日本語の方だけ** を 1 回書く
- 同じ商品を 2 回以上書かない
- 複数の異なる商品があれば、カンマ区切りで列挙
- 店名 (例: マクドナルド、すき家)、合計金額、支払い方法、受取時間、注文番号、住所、クーポンは絶対に書かない
- 「ドリンク」「セット」のような上位カテゴリだけの場合は、可能なら中身の商品名 (コーラ、ポテト等) を書く
- 商品名以外 (個数、単価、kcal、説明) は書かない
- 読み取れる商品名が無ければ「不明」とだけ書く`

const VLM_RECEIPT_USER_QUERY = 'この画面に表示されている、注文された商品名を全て答えてください。'

// VLM 経路の見た目ラベル切り替え用 (handler はモード引数で振り分ける)。
const VLM_MODE = {
  dish: {
    label: '料理写真',
    systemPrompt: VLM_SYSTEM_PROMPT,
    userQuery: VLM_USER_QUERY,
    failMessage:
      '料理を判別できませんでした。テキストで「カツ丼」のように直接入力してください。',
    failedAlertTitle: '料理写真の認識に失敗',
  },
  receipt: {
    label: 'レシート/注文画面',
    systemPrompt: VLM_RECEIPT_SYSTEM_PROMPT,
    userQuery: VLM_RECEIPT_USER_QUERY,
    failMessage:
      '商品名を判別できませんでした。注文画面/レシート全体が枠に収まる画像でやり直すか、テキストで直接入力してください。',
    failedAlertTitle: 'レシート/注文画面の認識に失敗',
  },
}

// 名前の重複判定に使う正規化キー:
//   - 小文字化、空白/全角空白/®/™/(R)(TM)/括弧書きを除去、半角→比較用
//   - "マックフライポテト®(L)" と "マックフライポテト L" を同一視
const normalizeForDedup = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[\s　・]/g, '')
    .trim()

// ASCII (英数字/記号) しか含まない判定 (日本語が 1 文字でもあれば false)
//   - レシート経路で英語表記の重複を捨てるのに使う。
//   - 日本語 = ひらがな (U+3040-309F)、カタカナ (U+30A0-30FF)、CJK 漢字 (U+4E00-9FFF)、半角カナ (U+FF66-FF9F)
const JA_CHAR_RE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]/
const isAsciiOnly = (s) => !JA_CHAR_RE.test(s)

// VLM 応答テキストを FoodCard 用 items 配列に変換する。
//   - カンマ区切り (全角/半角) で 1 行に複数料理 → 1 行 1 料理に展開
//   - 「不明」「分からない」のような応答は空配列 (= 認識失敗扱い)
//   - 30 文字以上のトークンは説明文の混入とみなして除外 (SmolVLM が時々英語の長文を返す対策)
//   - 各 item は quantity=1, unit='人前' (量は写真から推定しない方針、ユーザーが portion で調整)
//   - mode='receipt' のときは:
//       1) ASCII のみ (英語表記) は捨てる (日本語表記が並んでいる前提)
//       2) 正規化名で重複除去 (英/日 両方残った場合と完全重複の両方に効く)
const parseVlmResponseToItems = (text, mode = 'dish') => {
  if (!text) return []
  const cleaned = String(text).replace(/[\r\n]+/g, ',').trim()
  if (!cleaned) return []
  if (/^(不明|分からない|わからない|判別できません)/.test(cleaned)) return []
  let names = cleaned
    .split(/[,、，]/)
    .map((s) => s.trim().replace(/^[・\-*\d.\s]+/, '')) // 行頭の「・」「1.」「-」などを除去
    .filter((s) => s.length > 0 && s.length < 30)

  if (mode === 'receipt') {
    // (1) ASCII のみは英語表記の重複とみなして捨てる。ただし全件 ASCII のときは
    //     元の応答が英語レシートだった可能性があるので保持 (空にしてしまわない)。
    const hasAnyJa = names.some((n) => !isAsciiOnly(n))
    if (hasAnyJa) names = names.filter((n) => !isAsciiOnly(n))
    // (2) 正規化キーで重複除去 (順序保持)
    const seen = new Set()
    names = names.filter((n) => {
      const key = normalizeForDedup(n)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  return names.map((name) => ({ name, quantity: 1, unit: '人前' }))
}

const PARSER_SYSTEM_PROMPT = `あなたはユーザーの記録メッセージを構造化データに変換するパーサーです。
ユーザーが日本語で書いた内容を、種類(kind)に応じてJSONで出力してください。

kind の種類:
- "food":     食事の記録 (例: 食パン1枚、ささみ200g、カツ丼)
- "weight":   体重の記録 (例: 体重68.5kg、今朝70.2)
- "activity": 運動・活動の記録 (例: ランニング60分、ウォーキング30分)
- "unknown":  上記のいずれでもない

kind ごとの出力形式:
- food:     {"kind":"food","items":[{"name":..,"quantity":..,"unit":..}]}
- weight:   {"kind":"weight","weight_kg":68.5}
- activity: {"kind":"activity","activity_name":"ランニング","duration_min":60}
            または {"kind":"activity","activity_name":"ウォーキング","distance_km":2}
- unknown:  {"kind":"unknown"}

重要:
- "items" 配列は kind="food" のときだけ使う。activity / weight では絶対に items を作らない。
  activity は activity_name と duration_min/distance_km をトップレベルに直接入れる。

food のルール:
- 各食品について name, quantity, unit を抽出する
- name は一般的な表記に正規化する
- ユーザーが書いた数量はそのままの数値を使う (200g なら quantity=200, unit="g"。途中で桁を削らない)
- 数量や単位は、それが書かれている品目だけに付ける (他の品目に勝手にコピーしない)
- 単位は g / 個 / 本 / 杯 / 枚 / 切 / 缶 / 袋 / 人前 など自然なものを選ぶ
- 「大盛り」「少なめ」などのニュアンスは portion に入れる
- 数量も単位もどちらも書かれていない品目だけ quantity=1, unit="人前" にする
- estimated_kcal は指定量での常識的な kcal を整数で。わからなければ省略する (空文字や 0 を入れない)。栄養素 (protein/fat/carb) は推定しない

weight のルール:
- weight_kg は kg 単位の数値 ("68.5kg" なら 68.5、"70.2" だけでも 70.2)

activity のルール:
- activity_name は種目名。活用形ではなく一般的な名詞形に正規化する
  - 「歩く」「歩いて」「歩いた」「ウォーキング」 → "ウォーキング"
  - 「走る」「走った」「ランニング」「ジョギング」 → "ランニング"
  - 「自転車」「漕いだ」「サイクリング」 → "サイクリング"
  - 「泳いだ」「水泳」 → "水泳"
  - 「筋トレ」「ウェイト」 → "筋トレ"
- 「分」「時間」と書かれた数値は duration_min（分単位、"1時間"→60, "30分"→30）
- 「キロ」「km」「m」と書かれた数値は distance_km（km単位、"2キロ"→2, "5km"→5, "500m"→0.5）
  「キロ」「km」が付いていたら絶対に duration_min ではなく distance_km にする
- 時間と距離の両方が書かれていれば両方とも出力する
- 時間も距離もない（例: "ランニングした"）場合は kind="unknown" を返す

ユーザーへの返答はしない。JSONだけを返すこと。`

const FEW_SHOT_EXAMPLES = `以下の例を参考にしてください:

入力: ごはん大盛りとバナナ1本と焼き魚
出力: {"kind":"food","items":[{"name":"ごはん","quantity":1,"unit":"杯","portion":"大盛り","estimated_kcal":340},{"name":"バナナ","quantity":1,"unit":"本","estimated_kcal":86},{"name":"焼き魚","quantity":1,"unit":"切","estimated_kcal":150}]}

入力: 体重68.5kg
出力: {"kind":"weight","weight_kg":68.5}

入力: 30分で3キロ走った
出力: {"kind":"activity","activity_name":"ランニング","duration_min":30,"distance_km":3}

入力: お腹すいた
出力: {"kind":"unknown"}`

const buildSystemPrompt = () =>
  `${PARSER_SYSTEM_PROMPT}\n${getRecordSchemaPrompt()}\n${FEW_SHOT_EXAMPLES}\n/no_think`

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

// OCR の振り分けに失敗した (kind='unknown') ときの手入力カード用 IMessage。
//   rawText は OCR が読み取った生テキスト。カード側で参考表示。
//   food_log への登録はユーザー入力待ち。
const makeUnknownOcrMessage = (rawText) => {
  const stamp = Date.now()
  return {
    _id: `local-unknown-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    unknownOcr: { rawText: rawText ?? '' },
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

// LLM 出力 → kind ごとの dispatch。返り値は discriminated union:
//   { kind: 'food',     foodItems }                       — 食品 DB マッチ + kcal 計算済み
//   { kind: 'weight',   weight_kg }                       — ② で WeightCard 描画予定
//   { kind: 'activity', activity_name, duration_min?, distance_km? } — ③ で ActivityCard 描画予定
//   { kind: 'unknown' }                                   — 食事/体重/運動いずれでもない
//   { error }                                             — パース失敗
const parseAndDispatch = async (content, idx) => {
  let parsed
  try {
    parsed = parseRecordOutput(content)
  } catch (e) {
    return { error: e?.message ?? String(e) }
  }
  if (parsed.kind === 'food') {
    try {
      const enriched = await Promise.all(
        parsed.items.map(async (it, j) => {
          const matched = await findBestFood(it.name).catch((err) => {
            console.warn('[db] search failed for', it.name, err)
            return null
          })
          const computedKcal = computeKcalFromMatch(matched, it.quantity, it.unit, it.name)
          // DB ヒットを優先。無ければ LLM の estimated_kcal を採用 (どちらも無ければ null)。
          const baseKcal = computedKcal ?? it.estimated_kcal ?? null
          const kcalSource =
            computedKcal != null ? 'db' : it.estimated_kcal != null ? 'llm_estimate' : null
          return {
            id: `${idx}-${j}`,
            name: it.name,
            quantity: it.quantity,
            unit: it.unit,
            portion: normalizePortion(it.portion),
            baseKcal,
            kcalSource,
            matchedName: matched?.name ?? null,
            matchedFoodCode: matched?.food_code ?? null,
            matchedFoodId: matched?.id ?? null,
          }
        }),
      )
      return {
        kind: 'food',
        foodItems: enriched,
        ...(parsed.truncated ? { truncated: true } : {}),
      }
    } catch (e) {
      return { error: e?.message ?? String(e) }
    }
  }
  if (parsed.kind === 'weight') {
    return { kind: 'weight', weight_kg: parsed.weight_kg }
  }
  if (parsed.kind === 'activity') {
    // 体重を weight_log 最新から取る。プロフィール未登録 / 計測なしなら 60kg デフォルト。
    let weightKg = DEFAULT_WEIGHT_KG
    try {
      const latest = await getLatestWeight()
      if (latest?.weight_kg) weightKg = latest.weight_kg
    } catch (e) {
      console.warn('[db] getLatestWeight failed:', e?.message ?? e)
    }
    const est = estimateActivityKcal({
      activity_name: parsed.activity_name,
      duration_min: parsed.duration_min,
      distance_km: parsed.distance_km,
      weight_kg: weightKg,
    })
    return {
      kind: 'activity',
      activity_name: est.canonical_name ?? parsed.activity_name,
      duration_min: est.duration_min ?? parsed.duration_min ?? null,
      distance_km: parsed.distance_km ?? null,
      estimated_kcal: est.kcal,
      met: est.met,
      weight_kg_used: est.weight_kg_used,
    }
  }
  return { kind: 'unknown' }
}

export default function Chat() {
  // VLM orchestrator が modelContext オブジェクト全体を必要とする
  // (preventLlmLoad を切り替えるため) ので、destructure と別に変数で持つ。
  const modelCtx = useActiveModel()
  const {
    activeModel,
    currentRole,
    setCurrentRole,
    coachModel,
    fellBack,
    dismissFellBack,
    vlmEnabled,
    vlmModelId,
  } = modelCtx
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
  // FoodCard 「AI推定」ボタン押下中のメッセージ ID。 1 つだけ active。
  const [estimatingMessageId, setEstimatingMessageId] = useState(null)
  // 「AI推定」中の段階 ('swapping' = coach モデルロード中 / 'generating' = 推論中)。
  // FoodCard 側のラベル切替に使う。
  const [estimatingPhase, setEstimatingPhase] = useState(null)
  // updateFoodItem / deleteFoodItem は非同期で findBestFood や DB UPDATE を挟むため、
  // 最新 state を closure 越しに見られるよう ref ミラーを用意する。
  // (llmRef は下のブロックで既に用意されているのでここでは作らない)
  const localMessagesRef = useRef(localMessages)
  const llmCardsRef = useRef(llmCards)
  useEffect(() => {
    localMessagesRef.current = localMessages
  }, [localMessages])
  useEffect(() => {
    llmCardsRef.current = llmCards
  }, [llmCards])
  const [ocrBusy, setOcrBusy] = useState(false)
  const [visionBusy, setVisionBusy] = useState(false)
  // VLM 完了直後、executorch (parser) が再ロード完了するまでの「すき間」用フラグ。
  // この間は全画面ローディングを出さず、チャット UI を維持してタイピングインジケータ
  // を表示する (写真認識の体験が「ローディング画面でブツ切れ」になるのを防ぐ)。
  const [parserReloading, setParserReloading] = useState(false)
  const [mode, setMode] = useState('log') // 'log' | 'coach'

  // executorch が再 ready になった瞬間に parserReloading を落とす。
  useEffect(() => {
    if (llm.isReady && parserReloading) setParserReloading(false)
  }, [llm.isReady, parserReloading])

  // llm の最新参照を ref で保持。async 経路から現行 isReady などを見るために使う
  // (直接 llm を見るとクロージャに掴まれた古い参照になる)。
  const llmRef = useRef(llm)
  useEffect(() => {
    llmRef.current = llm
  }, [llm])
  const [inputText, setInputText] = useState('')
  // モード別に messageHistory / llmCards / localMessages のスナップショットを保持。
  // モード切替時に「現在モード→保存」「新モード→復元」して configure に渡す。
  // localMessages (VLM 画像 / FoodCard / OCR 結果) を mode 横断で残すと、コーチに
  // 切り替えたあとも記録モード固有のカードが見えてしまうため、こちらも snapshot 化する。
  const logHistoryRef = useRef([])
  const coachHistoryRef = useRef([])
  const logCardsRef = useRef({})
  const logLocalMessagesRef = useRef([])
  const coachLocalMessagesRef = useRef([])
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
        const result = await parseAndDispatch(m.content, idx)
        if (result.kind === 'food' && result.foodItems) {
          console.log('[parsed+enriched]', JSON.stringify(result.foodItems, null, 2))
          try {
            const insertedIds = await insertFoodLogItems(result.foodItems)
            // 編集 / 削除 UI から DB 行を引けるよう、INSERT 後の id を foodItems に焼き込む。
            // insertFoodLogItems は items と同じ順序で id を返す前提。
            result.foodItems = result.foodItems.map((it, j) => ({
              ...it,
              foodLogId: insertedIds[j] ?? null,
            }))
            const total = await countFoodLog()
            console.log(`[food_log] inserted ${insertedIds.length} rows (total ${total})`, insertedIds)
          } catch (e) {
            console.warn('[food_log] insert failed:', e?.message ?? e)
          }
        } else if (result.kind === 'weight') {
          console.log('[parsed weight]', result.weight_kg, 'kg (② で記録 UI を実装予定)')
        } else if (result.kind === 'activity') {
          const parts = [
            result.duration_min != null ? `${result.duration_min}分` : null,
            result.distance_km != null ? `${result.distance_km}km` : null,
            result.estimated_kcal != null ? `推定${result.estimated_kcal}kcal` : 'kcal推定不可',
          ].filter(Boolean)
          console.log('[parsed activity]', result.activity_name, parts.join(' / '))
        } else if (result.kind === 'unknown') {
          console.log('[parsed unknown] 食事/体重/運動いずれでもない')
        } else {
          console.log('[parse error]', result.error)
        }
        console.log('==============================')
        setLlmCards((prev) => ({ ...prev, [idx]: result }))
        // AI 応答が画面に出るタイミングでハプティック。成功 / 失敗で振動を出し分け。
        const isWarn = result.error || result.kind === 'unknown'
        Haptics.notificationAsync(
          isWarn
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success,
        ).catch(() => {})
      })()
    })
  }, [llm.messageHistory, llm.isGenerating, mode])

  // coach モードの Q&A を chat_messages テーブルに永続化。
  //   - 記録モードの会話は food_log が成果物として残るので保存しない。
  //   - DayDetail の「この日のコーチ対話」セクションで日付別に取り出して表示する。
  //   - AI 応答が画面に出たタイミングでハプティック (parser 側と同様の体感)。
  useEffect(() => {
    if (llm.isGenerating) return
    if (mode !== 'coach') return
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    let anyNew = false
    base.forEach((m, idx) => {
      if (m.role !== 'assistant') return
      if (persistedCoachRef.current.has(idx)) return
      const userMsg = base[idx - 1]
      if (userMsg?.role !== 'user') return
      const cleanedAssistant = stripThink(m.content)
      if (!cleanedAssistant) return // <think> しか出てこなかった等は保存しない
      persistedCoachRef.current.add(idx)
      anyNew = true
      insertCoachExchange({
        userText: userMsg.content,
        assistantText: cleanedAssistant,
        modelId: activeModel.id,
      }).catch((e) => console.warn('[chat] coach persist failed:', e?.message ?? e))
    })
    if (anyNew) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    }
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
      if (card?.kind === 'food' && card.foodItems) {
        items.push({
          _id: `h-${i}`,
          text: '',
          createdAt,
          user: ASSISTANT,
          foodItems: card.foodItems,
          truncated: card.truncated ?? false,
        })
      } else if (card?.kind === 'weight') {
        items.push({
          _id: `h-${i}`,
          text: '',
          createdAt,
          user: ASSISTANT,
          weightRecord: {
            initial_kg: card.weight_kg,
            savedWeightLogId: card.savedWeightLogId,
            savedSummary: card.savedSummary,
          },
        })
      } else if (card?.kind === 'activity') {
        items.push({
          _id: `h-${i}`,
          text: '',
          createdAt,
          user: ASSISTANT,
          activityRecord: {
            initial_name: card.activity_name,
            initial_duration_min: card.duration_min,
            initial_distance_km: card.distance_km,
            initial_kcal: card.estimated_kcal,
            met: card.met,
            weight_kg_used: card.weight_kg_used,
            savedEnergyLogId: card.savedEnergyLogId,
            savedSummary: card.savedSummary,
          },
        })
      } else if (card?.kind === 'unknown') {
        items.push({
          _id: `h-${i}`,
          text: '食事・体重・運動のいずれにも判定できませんでした。書き方を変えて試してみてください。',
          createdAt,
          user: ASSISTANT,
          isError: true,
        })
      } else if (card?.error) {
        items.push({
          _id: `h-${i}`,
          text: '記録を抽出できませんでした。もう少し具体的に書いてみてください。',
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
          logLocalMessagesRef.current = localMessages
        } else {
          coachHistoryRef.current = currentHist
          coachLocalMessagesRef.current = localMessages
        }
        const restoreCards = newMode === 'log' ? logCardsRef.current : {}
        const restoreLocalMessages =
          newMode === 'log' ? logLocalMessagesRef.current : coachLocalMessagesRef.current
        setLlmCards(restoreCards)
        setLocalMessages(restoreLocalMessages)
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
    [mode, llm, llmCards, localMessages, modeBusy, currentRole, setCurrentRole],
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
        const id = await insertWeightLog({
          weight_kg: parsed.latest,
          source: 'ocr',
          imageUri: uri,
        })
        resultText = formatWeightResult(parsed, id)
      } else {
        // 振り分け失敗時は UnknownOcrCard で手入力 → food_log 登録を案内
        console.log('=========================')
        setLocalMessages((prev) => [...prev, makeUnknownOcrMessage(rawText)])
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
        return
      }
      console.log('=========================')

      setLocalMessages((prev) => [...prev, makeOcrResultMessage(resultText)])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
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

  // 料理写真 → VLM 経路。llama.rn (llama.cpp バインディング) + vlmOrchestrator で
  // executorch を一時退避させ、llama.rn の completion + initMultimodal で
  // 料理名を抽出する。設計は docs/PLAN_VLM_llama_rn.md §2/§6 を参照。
  //   - vlmEnabled が OFF / モデル未 DL のときはアラート誘導
  //   - 推論中は visionBusy=true、終了時に false。orchestrator が executorch を
  //     復帰させるため、推論後は数秒間チャット入力が無効化される
  const handlePhotoForVision = useCallback(
    async (picker, mode = 'dish') => {
      if (visionBusy || ocrBusy) return
      const modeCfg = VLM_MODE[mode] ?? VLM_MODE.dish
      if (!vlmEnabled) {
        Alert.alert(
          '写真認識が無効です',
          '設定 > LLM モデル > 写真 で「写真認識を有効にする」を ON にしてください。',
        )
        return
      }
      const vlmModel = getVlmModelById(vlmModelId)
      const downloaded = await isVlmModelDownloaded(vlmModel).catch(() => false)
      if (!downloaded) {
        Alert.alert(
          'モデル未ダウンロード',
          `${vlmModel.label} がまだダウンロードされていません。設定 > LLM モデル > 写真 からダウンロードしてください。`,
        )
        return
      }

      let pickedUri = null
      let entered = false
      try {
        pickedUri = await picker()
        if (!pickedUri) return
        setVisionBusy(true)
        entered = true
        setLocalMessages((prev) => [...prev, makeUserImageMessage(pickedUri)])

        console.log(`========== Vision (llama.rn) [${modeCfg.label}] ==========`)
        console.log('[image]', pickedUri)
        console.log('[model]', vlmModel.id)

        // 端末カメラの 4032×3024 級は GPU メモリ圧迫するので 1024px 幅へ縮小。
        // llama.cpp は内部 letterbox するが、巨大画像をそのまま渡すと iOS が落ちる事例あり。
        //   レシート/注文画面はテキスト中心なので、料理写真より広めの 1280px を使う。
        //   (小さすぎると細かい商品名が潰れて読めない)
        const resizeWidth = mode === 'receipt' ? 1280 : 1024
        const resized = await ImageManipulator.manipulateAsync(
          pickedUri,
          [{ resize: { width: resizeWidth } }],
          { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
        )
        const imagePath = resized.uri
        console.log('[resized]', imagePath)

        const responseText = await runWithLlamaRn(
          { model: vlmModel, modelContext: modelCtx },
          async (llama) => {
            const res = await llama.completion({
              messages: [
                { role: 'system', content: modeCfg.systemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: imagePath } },
                    { type: 'text', text: modeCfg.userQuery },
                  ],
                },
              ],
              // jinja=true でモデル本体に含まれる正規 chat_template を使う。
              // デフォルト (jinja=false) だと llama-chat の簡易フォーマットになり、
              // system role が無視されて英語説明文が返るケースがあった。
              jinja: true,
              // 料理名だけ欲しいので短く + 揺らぎ最小に。
              //   レシート/注文画面は商品数が多くなる可能性があるので少し長めに取る。
              n_predict: mode === 'receipt' ? 192 : 64,
              temperature: 0.1,
            })
            return (res?.text ?? res?.content ?? '').toString()
          },
        )

        const cleaned = responseText.trim()
        console.log('[vlm response]', cleaned)

        const rawItems = parseVlmResponseToItems(cleaned, mode)
        if (rawItems.length === 0) {
          console.log('[vlm] no items parsed')
          console.log('======================================')
          setLocalMessages((prev) => [
            ...prev,
            makeOcrResultMessage(
              `【${modeCfg.label}認識】\n${modeCfg.failMessage}${
                cleaned ? `\n(応答: ${cleaned})` : ''
              }`,
            ),
          ])
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
          return
        }

        // 食品 DB マッチ + kcal 計算 (parseAndDispatch の food 分岐と同じ流儀)。
        const stamp = Date.now()
        const enriched = await Promise.all(
          rawItems.map(async (it, j) => {
            const matched = await findBestFood(it.name).catch((err) => {
              console.warn('[db] vlm search failed for', it.name, err)
              return null
            })
            const computedKcal = computeKcalFromMatch(matched, it.quantity, it.unit, it.name)
            return {
              id: `vlm-${stamp}-${j}`,
              name: it.name,
              quantity: it.quantity,
              unit: it.unit,
              portion: 'normal',
              baseKcal: computedKcal,
              // VLM 経路は料理名のみで estimated_kcal を出さないので、'db' or null のみ。
              // DB ミス品の kcal 推定が必要なら EditFood の「AI推定」ボタンで個別に行う。
              kcalSource: computedKcal != null ? 'db' : null,
              matchedName: matched?.name ?? null,
              matchedFoodCode: matched?.food_code ?? null,
              matchedFoodId: matched?.id ?? null,
            }
          }),
        )
        console.log('[vlm enriched]', JSON.stringify(enriched, null, 2))

        // テキスト経路と同じく即時 INSERT。
        //   - 料理写真: source='vision'
        //   - レシート/注文画面: source='receipt_vision' (将来の集計で区別したいので別値)
        const insertSource = mode === 'receipt' ? 'receipt_vision' : 'vision'
        let insertedIds = []
        try {
          insertedIds = await insertFoodLogItems(enriched, { source: insertSource })
          const total = await countFoodLog()
          console.log(
            `[food_log] vlm inserted ${insertedIds.length} rows (total ${total}, src=${insertSource})`,
            insertedIds,
          )
        } catch (e) {
          console.warn('[food_log] vlm insert failed:', e?.message ?? e)
        }
        console.log('======================================')

        const enrichedWithIds = enriched.map((it, j) => ({
          ...it,
          foodLogId: insertedIds[j] ?? null,
        }))

        setLocalMessages((prev) => [
          ...prev,
          {
            _id: `local-vlm-${stamp}`,
            text: '',
            createdAt: new Date(stamp + 1),
            user: ASSISTANT,
            foodItems: enrichedWithIds,
          },
        ])
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      } catch (e) {
        console.warn('[vision] failed:', e?.message ?? e)
        setLocalMessages((prev) => [
          ...prev,
          makeOcrResultMessage(`${modeCfg.failedAlertTitle}: ${e?.message ?? e}`),
        ])
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      } finally {
        setVisionBusy(false)
        // orchestrator finally で setPreventLlmLoad(false) → executorch 再ロードが走るが、
        // ここでは isReady=false の状態。全画面ローディングを出さないために
        // parserReloading を立て、useEffect で isReady=true になったタイミングで落とす。
        if (entered) setParserReloading(true)
      }
    },
    [visionBusy, ocrBusy, vlmEnabled, vlmModelId, modelCtx],
  )

  // 撮影/ライブラリ選択の共通 ActionSheet (OCR と VLM どちらの handler でも使う)
  const showPickerSheet = useCallback(
    (callback) => {
      showActionSheetWithOptions(
        {
          options: ['カメラで撮影', 'ライブラリから選択', 'キャンセル'],
          cancelButtonIndex: 2,
        },
        (selectedIndex) => {
          if (selectedIndex === 0) callback(captureFromCamera)
          else if (selectedIndex === 1) callback(pickFromLibrary)
        },
      )
    },
    [showActionSheetWithOptions],
  )

  const onPressAttach = useCallback(() => {
    if (ocrBusy || visionBusy) return
    const options = [
      'OCR で読む (ラベル / 体重 / フィットネス)',
      '料理写真として認識',
      'レシート / 注文画面を読み取り',
      'キャンセル',
    ]
    const cancelButtonIndex = 3
    showActionSheetWithOptions(
      { options, cancelButtonIndex, title: '画像の使い方を選ぶ' },
      (selectedIndex) => {
        if (selectedIndex === 0) showPickerSheet(handleImage)
        else if (selectedIndex === 1) showPickerSheet((p) => handlePhotoForVision(p, 'dish'))
        else if (selectedIndex === 2) showPickerSheet((p) => handlePhotoForVision(p, 'receipt'))
      },
    )
  }, [showActionSheetWithOptions, showPickerSheet, handleImage, handlePhotoForVision, ocrBusy, visionBusy])

  const renderActions = useCallback(
    () => {
      const busy = ocrBusy || visionBusy
      return (
        <TouchableOpacity
          style={styles.attachButton}
          onPress={onPressAttach}
          disabled={busy}
          activeOpacity={0.7}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.lightPurple} />
          ) : (
            <FontIcon name="camera" size={22} color={colors.lightPurple} />
          )}
        </TouchableOpacity>
      )
    },
    [onPressAttach, ocrBusy, visionBusy],
  )

  // ref ミラーから (messageId, itemId) で foodItem を引く。
  const findFoodItemSnapshot = useCallback((messageId, itemId) => {
    if (messageId.startsWith('local-card-') || messageId.startsWith('local-vlm-')) {
      const m = localMessagesRef.current.find((x) => x._id === messageId)
      return m?.foodItems?.find((it) => it.id === itemId) ?? null
    }
    if (messageId.startsWith('h-')) {
      const idx = Number(messageId.slice(2))
      return llmCardsRef.current[idx]?.foodItems?.find((it) => it.id === itemId) ?? null
    }
    return null
  }, [])

  // foodItem を patch でマージしてローカル state に反映。
  const applyFoodItemPatch = useCallback((messageId, itemId, patch) => {
    if (messageId.startsWith('local-card-') || messageId.startsWith('local-vlm-')) {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && m.foodItems
            ? {
                ...m,
                foodItems: m.foodItems.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
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
            foodItems: entry.foodItems.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
          },
        }
      })
    }
  }, [])

  const removeFoodItemRow = useCallback((messageId, itemId) => {
    if (messageId.startsWith('local-card-') || messageId.startsWith('local-vlm-')) {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && m.foodItems
            ? { ...m, foodItems: m.foodItems.filter((it) => it.id !== itemId) }
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
          [idx]: { ...entry, foodItems: entry.foodItems.filter((it) => it.id !== itemId) },
        }
      })
    }
  }, [])

  // FoodCard 上の編集 (portion ピル / 料理名インライン編集) の集約ハンドラ。
  //   - name 変更時は findBestFood で再マッチして baseKcal / matched* を更新する。
  //   - foodLogId が振られていれば food_log を UPDATE する (現状は portion 変更も DB に反映される)。
  const updateFoodItem = useCallback(
    async (messageId, itemId, updates) => {
      const before = findFoodItemSnapshot(messageId, itemId)
      if (!before) return

      const patch = {}
      let nextName = before.name
      let nextBaseKcal = before.baseKcal
      let nextMatchedId = before.matchedFoodId ?? null
      let nextMatchedName = before.matchedName ?? null
      let nextMatchedCode = before.matchedFoodCode ?? null
      let nextPortion = before.portion ?? 'normal'
      let nextKcalSource = before.kcalSource ?? null

      if ('name' in updates) {
        const trimmed = (updates.name ?? '').trim()
        if (!trimmed || trimmed === before.name) {
          // 空 or 変更なしなら name の更新はスキップ。portion の更新は続行する。
        } else {
          const matched = await findBestFood(trimmed).catch((e) => {
            console.warn('[db] foodcard edit search failed:', e?.message ?? e)
            return null
          })
          nextName = trimmed
          nextBaseKcal = computeKcalFromMatch(matched, before.quantity, before.unit, trimmed)
          nextMatchedId = matched?.id ?? null
          nextMatchedName = matched?.name ?? null
          nextMatchedCode = matched?.food_code ?? null
          // 名前が変わったら元の LLM 推定値は破棄。 DB ヒットしたら 'db'、しなければ null。
          nextKcalSource = nextBaseKcal != null ? 'db' : null
          patch.name = nextName
          patch.baseKcal = nextBaseKcal
          patch.matchedFoodId = nextMatchedId
          patch.matchedName = nextMatchedName
          patch.matchedFoodCode = nextMatchedCode
          patch.kcalSource = nextKcalSource
        }
      }
      if ('portion' in updates) {
        nextPortion = updates.portion ?? 'normal'
        patch.portion = nextPortion
      }
      if (Object.keys(patch).length === 0) return

      applyFoodItemPatch(messageId, itemId, patch)

      if (before.foodLogId != null) {
        try {
          await updateFoodLogItem(before.foodLogId, {
            name: nextName,
            portion: nextPortion,
            baseKcal: nextBaseKcal,
            matchedFoodId: nextMatchedId,
            kcalSource: nextKcalSource,
          })
        } catch (e) {
          console.warn('[food_log] update failed:', e?.message ?? e)
        }
      }
    },
    [findFoodItemSnapshot, applyFoodItemPatch],
  )

  // FoodCard 「AI推定」ボタンのハンドラ。
  //   - そのカード内の baseKcal==null な item を全て集める
  //   - parser (0.6B) では知識不足で精度低 (家系ラーメン → 370 kcal など) のため、
  //     一時的に coach モデル (1.7B+) にスワップして推定。終わったら元のロールに戻す。
  //   - 完了ごとに applyFoodItemPatch + updateFoodLogItem で UI と DB を更新
  //   - kcalSource='llm_estimate' なので FoodCard 上で「(推定)」バッジが付く
  const handleEstimateMissingKcal = useCallback(
    async (messageId) => {
      if (estimatingMessageId) return
      if (!llm || !llm.isReady || llm.isGenerating) {
        Alert.alert('AI モデルが準備中', '少し待ってから「AI推定」を押してください。')
        return
      }
      // メッセージから対象 item を集める。
      let foodItems = null
      if (messageId.startsWith('local-card-') || messageId.startsWith('local-vlm-')) {
        foodItems = localMessagesRef.current.find((m) => m._id === messageId)?.foodItems
      } else if (messageId.startsWith('h-')) {
        const idx = Number(messageId.slice(2))
        foodItems = llmCardsRef.current[idx]?.foodItems
      }
      const targets = (foodItems ?? []).filter(
        (it) => it.baseKcal == null && it.name?.trim(),
      )
      if (targets.length === 0) return

      const originalRole = currentRole
      const needSwap = originalRole !== 'coach'
      setEstimatingMessageId(messageId)
      setEstimatingPhase(needSwap ? 'swapping' : 'generating')

      try {
        // 1) coach に切替 (必要なら) → isReady を待つ。
        //   注意: setCurrentRole の直後はまだ React 再 render が走っていないので、
        //   llmRef.current は古い parser のままで isReady=true を返す → 即 break → unload 済みモデルに
        //   generate して "model is currently not loaded" エラー、というレース条件がある。
        //   なので 2 段階に分ける:
        //     Phase 1: isReady が false に落ちる (= 新モデルのロードが始まった) のを待つ
        //     Phase 2: isReady が true に戻る (= 新モデルが ready になった) のを待つ
        //   Phase 1 が 5 秒タイムアウトしたら parser=coach 同モデル設定とみなしてそのまま進む。
        if (needSwap) {
          await setCurrentRole('coach')
          const phase1Start = Date.now()
          let swapStarted = false
          while (Date.now() - phase1Start < 5_000) {
            if (!llmRef.current?.isReady) {
              swapStarted = true
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          if (swapStarted) {
            const phase2Start = Date.now()
            while (Date.now() - phase2Start < 30_000) {
              const cur = llmRef.current
              if (cur?.isReady && !cur?.isGenerating) break
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
            if (!llmRef.current?.isReady) {
              throw new Error('コーチモデルのロードがタイムアウトしました')
            }
          }
          setEstimatingPhase('generating')
        }

        // coach に repetitionPenalty を効かせる。
        //   - 1.7B は判断に迷うと同じ思考を 5 回以上繰り返して max_seq_len を食い潰す。
        //     temperature を下げ、 repetitionPenalty で同一トークン列の再生成を抑止する。
        //   - 副作用: configure は chatConfig も DEFAULT にリセットするが、推定終了後に parser へ
        //     swap-back する際に Chat.js useEffect が再 configure するため log モードでは問題なし。
        //   - estimateKcalBatch は generate(messages) を直接呼ぶので chatConfig.systemPrompt は不使用。
        try {
          llmRef.current?.configure({
            generationConfig: { temperature: 0.1, repetitionPenalty: 1.1 },
          })
        } catch (e) {
          console.warn('[ai kcal] configure (coach) failed:', e?.message ?? e)
        }

        // 2) 推定 (最新の llm を ref から取る)。
        await estimateKcalBatch(
          llmRef.current,
          targets.map((it) => ({
            id: it.id,
            name: it.name,
            quantity: it.quantity,
            unit: it.unit,
          })),
          {
            modelLabel: coachModel?.id ?? 'coach',
            onItemDone: async (it, result) => {
              if (!result.ok) return
              const baseItem = (foodItems ?? []).find((x) => x.id === it.id)
              const foodLogId = baseItem?.foodLogId ?? null
              const patch = { baseKcal: result.kcal, kcalSource: 'llm_estimate' }
              applyFoodItemPatch(messageId, it.id, patch)
              if (foodLogId != null) {
                try {
                  await updateFoodLogItem(foodLogId, {
                    baseKcal: result.kcal,
                    kcalSource: 'llm_estimate',
                  })
                } catch (e) {
                  console.warn('[food_log] estimate update failed:', e?.message ?? e)
                }
              }
            },
          },
        )
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      } catch (e) {
        console.warn('[ai kcal batch] failed:', e?.message ?? e)
        Alert.alert('AI推定に失敗', e?.message ?? String(e))
      } finally {
        // 3) 元のロールに戻す (必要なら)。 await はしない (戻りは backgrond で OK、 UI は解放)。
        if (needSwap) {
          setCurrentRole(originalRole).catch(() => {})
        }
        setEstimatingMessageId(null)
        setEstimatingPhase(null)
      }
    },
    [estimatingMessageId, llm, currentRole, setCurrentRole, applyFoodItemPatch],
  )

  // FoodCard の行削除ハンドラ。ローカル state から除去し、保存済みなら food_log も DELETE。
  const deleteFoodItem = useCallback(
    async (messageId, itemId) => {
      const before = findFoodItemSnapshot(messageId, itemId)
      if (!before) return
      removeFoodItemRow(messageId, itemId)
      if (before.foodLogId != null) {
        try {
          await deleteFoodLogItem(before.foodLogId)
        } catch (e) {
          console.warn('[food_log] delete failed:', e?.message ?? e)
        }
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [findFoodItemSnapshot, removeFoodItemRow],
  )

  // テキスト経由の体重カードの「記録する」ハンドラ。
  //   weight_log に source='text' で1行入れ、llmCards のエントリに saved 状態をマージする。
  const handleWeightSave = useCallback(
    async (messageId, { weight_kg }) => {
      const id = await insertWeightLog({ weight_kg, source: 'text' })
      const summary = `${weight_kg} kg を記録しました (#${id})`
      if (messageId.startsWith('h-')) {
        const idx = Number(messageId.slice(2))
        setLlmCards((prev) => {
          const entry = prev[idx]
          if (!entry || entry.kind !== 'weight') return prev
          return {
            ...prev,
            [idx]: {
              ...entry,
              savedWeightLogId: id,
              savedSummary: summary,
            },
          }
        })
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [],
  )

  // OCR 振り分け失敗時の手入力カードの「食事として記録」ハンドラ。
  //   kcal が null なら食品 DB 検索で baseKcal を補完。入力されていればそのまま使う。
  //   food_log に source='ocr_manual' で1行 INSERT。
  const handleUnknownOcrSave = useCallback(
    async (messageId, { name, quantity, unit, kcal }) => {
      let baseKcal = kcal
      let matched = null
      // kcal を手で入れた → 'manual'。空欄で DB 補完が当たった → 'db'。 どちらもなら null。
      let kcalSource = kcal != null ? 'manual' : null
      if (baseKcal == null) {
        matched = await findBestFood(name).catch((e) => {
          console.warn('[db] search failed:', e?.message ?? e)
          return null
        })
        baseKcal = computeKcalFromMatch(matched, quantity, unit, name)
        if (baseKcal != null) kcalSource = 'db'
      }
      const [id] = await insertFoodLogItems(
        [
          {
            name,
            quantity,
            unit,
            portion: 'normal',
            baseKcal,
            matchedFoodId: matched?.id ?? null,
            kcalSource,
          },
        ],
        { source: 'ocr_manual' },
      )
      const summary = `${name} ${quantity}${unit}${
        baseKcal != null ? ` · ${baseKcal} kcal` : ''
      }`
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId
            ? {
                ...m,
                unknownOcr: {
                  ...m.unknownOcr,
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

  // テキスト経由の活動量カードの「記録する」ハンドラ。
  //   energy_log に source='text' で1行入れ、llmCards のエントリに saved 状態をマージする。
  const handleActivitySave = useCallback(
    async (messageId, { activity_name, duration_min, active_kcal }) => {
      const id = await insertEnergyLog({
        activity_name,
        duration_min,
        active_kcal,
        source: 'text',
      })
      const summary = `${activity_name} ${duration_min}分 / ${active_kcal} kcal を記録しました (#${id})`
      if (messageId.startsWith('h-')) {
        const idx = Number(messageId.slice(2))
        setLlmCards((prev) => {
          const entry = prev[idx]
          if (!entry || entry.kind !== 'activity') return prev
          return {
            ...prev,
            [idx]: {
              ...entry,
              savedEnergyLogId: id,
              savedSummary: summary,
            },
          }
        })
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [],
  )

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
            onDeleteItem={deleteFoodItem}
            onEstimateMissing={handleEstimateMissingKcal}
            estimating={estimatingMessageId === current._id}
            estimatingPhase={estimatingMessageId === current._id ? estimatingPhase : null}
            title={current.isDummy ? '食品カード（ダミー）' : '抽出された食品'}
          />
        )
      }
      if (current?.labelRecord) {
        return <LabelRecordCard message={current} onSave={handleLabelSave} />
      }
      if (current?.weightRecord) {
        return <WeightCard message={current} onSave={handleWeightSave} />
      }
      if (current?.activityRecord) {
        return <ActivityCard message={current} onSave={handleActivitySave} />
      }
      if (current?.unknownOcr) {
        return <UnknownOcrCard message={current} onSave={handleUnknownOcrSave} />
      }
      return <Bubble {...props} renderMessageText={renderAssistantMarkdown} />
    },
    [
      updateFoodItem,
      deleteFoodItem,
      handleEstimateMissingKcal,
      estimatingMessageId,
      estimatingPhase,
      handleLabelSave,
      handleWeightSave,
      handleActivitySave,
      handleUnknownOcrSave,
    ],
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
          <Text style={styles.emptyText}>
            食事・体重・運動を送ると、自動で分解してカードにします。
          </Text>

          <Text style={styles.sectionLabel}>🍱 食事</Text>
          <View style={styles.exampleBlock}>
            <Text style={styles.exampleLine}>・プレーンヨーグルト200g</Text>
            <Text style={styles.exampleLine}>・カツ丼と缶チューハイ2本</Text>
            <Text style={styles.exampleLine}>・ごはん大盛りと焼き魚</Text>
          </View>
          <Text style={styles.captionText}>
            数量と単位を書くと正確 (食パン1枚、ささみ200g)。「大盛り」「少なめ」も OK。
          </Text>

          <Text style={styles.sectionLabel}>⚖ 体重</Text>
          <View style={styles.exampleBlock}>
            <Text style={styles.exampleLine}>・体重68.5kg</Text>
            <Text style={styles.exampleLine}>・今朝70.2</Text>
          </View>

          <Text style={styles.sectionLabel}>🏃 運動</Text>
          <View style={styles.exampleBlock}>
            <Text style={styles.exampleLine}>・ランニング60分</Text>
            <Text style={styles.exampleLine}>・2キロ歩いた</Text>
            <Text style={styles.exampleLine}>・30分自転車</Text>
          </View>
          <Text style={styles.captionText}>「分」「時間」「km」「キロ」を含めると認識されます。</Text>

          <Text style={styles.sectionLabel}>📷 スクショ・写真</Text>
          <Text style={styles.captionText}>
            左下のカメラから、食品ラベル・体重計・フィットネスアプリのスクショを OCR で読み取れます。
          </Text>

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

  // VLM 推論中は orchestrator が preventLoad=true で executorch を一時退避するため
  // llm.isReady が false に落ちる。この間は全画面ロード表示ではなく通常 chat UI を
  // 維持し、進行状況は📷ボタンの spinner と localMessages で示す。
  // parserReloading=true の間 (VLM 完了 → executorch 再 ready までの隙間) も同様に
  // 全画面ローディングを出さず、タイピングインジケータで「AI 応答準備中」を示す。
  if (!llm.isReady && !visionBusy && !parserReloading) {
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
        placeholder={mode === 'coach' ? 'コーチに質問する（例: 今週どうだった？）' : '食事・体重・運動を入力'}
        isTyping={llm.isGenerating || parserReloading}
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
