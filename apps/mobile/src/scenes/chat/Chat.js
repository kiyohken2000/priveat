import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import RecipeCard from './RecipeCard'
import WeightCard from './WeightCard'
import ActivityCard from './ActivityCard'
import UnknownOcrCard from './UnknownOcrCard'
import { getRecordSchemaPrompt, parseRecordOutput, parseStage2Output } from './schema'
import { computeKcalFromMatch, findBestFood } from '../../db/search'
import {
  countFoodLog,
  deleteFoodLogItem,
  insertFoodLogFromLabel,
  insertFoodLogItems,
  updateFoodLogItem,
} from '../../db/foodLog'
import { insertCoachExchange } from '../../db/chatMessages'
import { saveRecipe } from '../../db/recipes'
import * as Clipboard from 'expo-clipboard'
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

// renderMessageText を Chat 内で組み立てる factory。 長押しコピーを発火させるため
// 外側を Pressable で包み、 EnrichedMarkdownText の selectable は外す
// (selectable=true だと内部 Text が長押しを横取りして Pressable まで届かない)。
const makeRenderMessageText = (onLongPress) => (textProps) => {
  const msg = textProps.currentMessage
  const isAssistant = msg?.user?._id === ASSISTANT._id
  const text = (msg?.text ?? '').trim()
  const inner =
    !isAssistant || !text ? (
      <MessageText {...textProps} />
    ) : (
      <View style={chatMarkdownStyles.wrap}>
        <EnrichedMarkdownText
          markdown={text}
          markdownStyle={MARKDOWN_STYLE}
          flavor="github"
          allowTrailingMargin={false}
        />
      </View>
    )
  return (
    <Pressable
      onLongPress={() => onLongPress(text)}
      delayLongPress={350}
    >
      {inner}
    </Pressable>
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
  '夕食何にしよう？',
  '今日は何を食べたらいい？',
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
//   - 各 item は quantity=1, unit='人前' (量は写真から推定しない方針、ユーザーがテンキーで調整)
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
- ★最優先ルール: items はユーザー入力に **明示的に書かれた品目だけ** を抽出する。 入力に出てこない品目を絶対に追加しない (例: 「無水カレー一食」だけの入力なら items は必ず1つ。 「ごはん」「バナナ」など few-shot 例にあった品目を勝手に混ぜない)
- ★最優先ルール: name はユーザーが書いた料理名を文字通り使う。 1 文字も削らない / 短くしない
  - 「無水カレー」→ "無水カレー" (○) / "カレー" (✗)
  - 「冷やし中華」→ "冷やし中華" (○) / "中華" (✗)
  - 「特製ラーメン」→ "特製ラーメン" (○) / "ラーメン" (✗)
- 表記揺れの正規化は「ご飯/ライス → ごはん」程度の言い換えのみ可。 単語の追加や削除はしない
- ユーザーが書いた数量はそのままの数値を使う (200g なら quantity=200, unit="g"。途中で桁を削らない)
- 数量や単位は、それが書かれている品目だけに付ける (他の品目に勝手にコピーしない)
- 単位は g / 個 / 本 / 杯 / 枚 / 切 / 缶 / 袋 / 人前 など自然なものを選ぶ
- 数量も単位もどちらも書かれていない品目だけ quantity=1, unit="人前" にする
- estimated_kcal は (quantity × unit) の合計 kcal を整数で。 「大盛り」 「少なめ」 などのニュアンスもここに反映する (大盛りなら多めの kcal、 少なめなら少ない kcal)。 わからなければ省略する (空文字や 0 を入れない)。 栄養素 (protein/fat/carb) は推定しない

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

// few-shot は engine ごとに分岐する。
//   - executorch (qwen3-0.6b): プロンプトを少しでも長くすると "Failed to generate text"
//     や 1 token で停止する症状が出る (2f63dbd / 多品目例追加検証で再現)。
//     単品の food 例だけに絞った最小版を使う。 多品目入力は flattenWrappedItems に
//     救済を委ねる (先頭 1 品目だけでも記録できる方が UX として良い)。
//   - llama.rn (LFM2.5-1.2B-JP / Gemma3-1B): 単品例だけだと「と」連結の複数品目を
//     欠落させがちなので、 短い 2 品目例を 1 件追加して学習させる。
const FEW_SHOT_FOOD_SINGLE = `入力: 鶏むね200g
出力: {"kind":"food","items":[{"name":"鶏むね","quantity":200,"unit":"g","estimated_kcal":230}]}

入力: カレー一食
出力: {"kind":"food","items":[{"name":"カレー","quantity":1,"unit":"食","estimated_kcal":600}]}

入力: 無水カレー一食
出力: {"kind":"food","items":[{"name":"無水カレー","quantity":1,"unit":"食","estimated_kcal":600}]}`

const FEW_SHOT_FOOD_MULTI = `入力: カツ丼と缶チューハイ2本
出力: {"kind":"food","items":[{"name":"カツ丼","quantity":1,"unit":"杯","estimated_kcal":850},{"name":"缶チューハイ","quantity":2,"unit":"本","estimated_kcal":140}]}`

const FEW_SHOT_TAIL = `入力: 体重68.5kg
出力: {"kind":"weight","weight_kg":68.5}

入力: 30分で3キロ走った
出力: {"kind":"activity","activity_name":"ランニング","duration_min":30,"distance_km":3}

入力: お腹すいた
出力: {"kind":"unknown"}`

const buildFewShot = (engine) => {
  // engine が未指定なら安全側 (executorch 互換) に倒す。
  const includeMulti = engine === 'llama_rn'
  const foodBlock = includeMulti
    ? `${FEW_SHOT_FOOD_SINGLE}\n\n${FEW_SHOT_FOOD_MULTI}`
    : FEW_SHOT_FOOD_SINGLE
  return `以下の例を参考にしてください:\n\n${foodBlock}\n\n${FEW_SHOT_TAIL}`
}

export const buildSystemPrompt = (engine) =>
  `${PARSER_SYSTEM_PROMPT}\n${getRecordSchemaPrompt()}\n${buildFewShot(engine)}\n/no_think`

// ---- 2-stage parser POC 用プロンプト (BenchmarkScreen で使用) -----------
// Stage 1: kind 分類のみ。 出力は {"kind":"food"} のような短い JSON。
// Stage 2: kind ごとの専用プロンプトで詳細抽出。 単発版より各ステージが
// 短くなる + few-shot が絞れるので精度向上を期待する。 現状は POC で
// food のみ実装。 weight/activity/recipe は単発版で問題が無いため省略。
const STAGE1_KIND_PROMPT = `あなたはユーザーのメッセージを分類するクラシファイアです。
入力を以下のいずれかに分類してください:
- "food":     食事の記録 (例: カツ丼、 鶏むね200g、 ごはんとサラダ)
- "weight":   体重の記録 (例: 体重68.5kg、 今朝70.2)
- "activity": 運動の記録 (例: ランニング30分、 5km走った)
- "recipe":   自炊レシピ (「N食分作った」 のように複数食分まとめて作る記述)
- "unknown":  上記いずれでもない

{"kind":"<分類>"} の形だけで返答してください。 説明やコードフェンスは不要。
/no_think`

const STAGE2_FOOD_PROMPT = `あなたは食事の記述を構造化データに変換するパーサーです。
ユーザー入力から食事の品目を抽出し、 {"items":[...]} の形で出力してください。

ルール:
- 各品目は name / quantity / unit を必須、 estimated_kcal は任意 (整数、 0-2000)
- 入力に明示的に書かれた品目だけ抽出 (例の品目を勝手に混ぜない)
- name は入力の語をそのまま使う (短縮しない、 1 文字も削らない)
- 単位は g / 個 / 本 / 杯 / 枚 / 切 / 缶 / 袋 / 人前 など自然なものを選ぶ
- 「200g」 「2本」 のように数量・単位が書かれていればそのまま使う
- 数量も単位も無い品目だけ quantity=1, unit="人前"
- 「大盛り」 「少なめ」 などのニュアンスは estimated_kcal に反映する (大盛りなら多めの kcal、 少なめなら少ない kcal)

例:
入力: 鶏むね200g
出力: {"items":[{"name":"鶏むね","quantity":200,"unit":"g","estimated_kcal":230}]}

入力: ごはん大盛りとバナナ1本と焼き魚
出力: {"items":[{"name":"ごはん","quantity":1,"unit":"杯","estimated_kcal":340},{"name":"バナナ","quantity":1,"unit":"本","estimated_kcal":86},{"name":"焼き魚","quantity":1,"unit":"切","estimated_kcal":150}]}

ユーザーへの返答はしない。 JSON だけを返すこと。
/no_think`

export const buildStage1Prompt = () => STAGE1_KIND_PROMPT
export const buildStage2FoodPrompt = () => STAGE2_FOOD_PROMPT

// ---- ルールベース kind 分類器 (LLM stage1 の代替) ----------------------
// LLM stage1 が 「鶏むね200g」 を weight/recipe と誤分類するベンチ結果が出たため、
// LLM の代わりに正規表現で kind を判定する。 食事アプリの入力ドメインは
// constrained (weight/activity/recipe は literal キーワードが強い) なので、
// 正規表現で 95%+ の精度が出る見込み。
// 設計方針:
//   - food 優先 (最頻出かつ多様。 明確な signal が無ければ food にフォールバック)
//   - 体重 → 「体重」 キーワード OR 純数値 (体重相場 30-200kg)
//   - 運動 → 運動動詞 (走/歩/泳/筋トレ/サイクリング 等)
//   - レシピ → 「食分」 「人前」 + 「作」 系動詞 (まとめ作り)
//   - その他 → food (parser が品目抽出を試みる)
// ambiguous なケースは food に倒して、 後段 stage2 で 「items 抽出失敗」 と
// なれば誠実なエラーメッセージを返すほうが、 weight/activity に誤分類して
// 体重値を勝手に取り出すよりマシ。
export const classifyByRules = (input) => {
  const s = String(input || '').trim()
  if (!s) return 'unknown'

  // recipe: 食分/人前 と 作る系動詞の両方
  if (/(食分|人前)/.test(s) && /作/.test(s)) return 'recipe'

  // activity: 運動動詞 OR 運動名
  if (
    /(走|歩い|歩く|歩いた|泳|漕|ラン(ニング)?|ジョグ|ジョギング|ウォーク|ウォーキング|サイクリング|自転車|筋トレ|ヨガ|ストレッチ|スクワット|腕立て|懸垂|ベンチプレス|デッドリフト)/.test(s)
  ) {
    return 'activity'
  }

  // weight:
  //   1. 「体重」 キーワード明示
  //   2. 純数値 (体重相場 30-200kg、 任意 kg/キロ 単位)
  if (/体重/.test(s)) return 'weight'
  const pureNum = s.match(/^\s*(\d{2,3}(?:\.\d+)?)\s*(?:kg|キロ|キログラム)?\s*$/i)
  if (pureNum) {
    const n = parseFloat(pureNum[1])
    if (n >= 30 && n <= 200) return 'weight'
  }

  return 'food'
}

// ---- kind 別 stage2 プロンプト ----------------------------------------
// 各 kind が極端に短く focused になるので、 単発の 4372 chars プロンプトより
// モデルが think に時間を取られない (ベンチでは多品目 food で 2-3x 高速化)。
const STAGE2_WEIGHT_PROMPT = `あなたは体重の数値を抽出するパーサーです。
ユーザー入力から体重 (kg 単位) を抽出し、 {"weight_kg":<数値>} の形だけで出力してください。

ルール:
- 「68.5kg」 → 68.5、 「70.2」 だけでも 70.2
- 単位省略は kg として扱う
- 整数も小数も可

例:
入力: 体重68.5kg
出力: {"weight_kg":68.5}

入力: 70.2
出力: {"weight_kg":70.2}

入力: 今朝の体重65
出力: {"weight_kg":65}

JSON だけを返すこと。
/no_think`

const STAGE2_ACTIVITY_PROMPT = `あなたは運動の記述を構造化データに変換するパーサーです。
ユーザー入力から種目・時間・距離を抽出し、 {"activity_name":..,"duration_min":..,"distance_km":..} の形で出力してください。

ルール:
- activity_name は名詞形に正規化:
  - 走った/ランニング/ジョギング → "ランニング"
  - 歩いた/ウォーキング → "ウォーキング"
  - 泳いだ/水泳 → "水泳"
  - 自転車/漕いだ/サイクリング → "サイクリング"
  - 筋トレ/ウェイト → "筋トレ"
- duration_min は分単位 ("30分" → 30、 "1時間" → 60)
- distance_km は km 単位 ("3km"/"3キロ" → 3、 "500m" → 0.5)
- 該当しないフィールドは出力に含めない (省略可)

例:
入力: 30分で3キロ走った
出力: {"activity_name":"ランニング","duration_min":30,"distance_km":3}

入力: ウォーキング1時間
出力: {"activity_name":"ウォーキング","duration_min":60}

入力: 5km走った
出力: {"activity_name":"ランニング","distance_km":5}

JSON だけを返すこと。
/no_think`

export const buildStage2WeightPrompt = () => STAGE2_WEIGHT_PROMPT
export const buildStage2ActivityPrompt = () => STAGE2_ACTIVITY_PROMPT

// レシピモード専用 parser プロンプト。
//   - kind は必ず "recipe" にする。 食事/体重/運動と判定したくなる入力でも recipe で返す。
//   - ingredients は最低 1 つ、 servings は必須。
//   - 「N食分」「N人前」が省略されていたら servings=1 として扱う (後段の UI で食数編集可能)。
const RECIPE_PARSER_SYSTEM_PROMPT = `あなたはユーザーの自炊レシピ入力を構造化データに変換するパーサーです。
ユーザーが日本語で書いた材料リストと食数を、 必ず {"kind":"recipe", ...} の形で JSON 出力してください。

出力形式:
{"kind":"recipe","name":"<料理名>","servings":<食数>,"ingredients":[{"name":..,"quantity":..,"unit":..}, ...]}

ルール:
- name は完成料理の名前 (例: 「無水カレー」「親子丼」)。 入力に明示されていない場合は短く要約する (「カレー」「煮物」など)。
- servings は何食分作ったか。 「5食分」→ 5、 「3人前」→ 3。 「5食か6食」のように幅があれば小さい方 (5)。 省略されていたら 1。
- ingredients の各要素は name / quantity / unit を持つ。
  - quantity は数値 (「500g」→ 500、 「1缶」→ 1)。
  - unit は g / 個 / 本 / 缶 / パック / 袋 / 大さじ / 小さじ / ml など、 入力から読み取れる自然な単位。
- 入力が食事・体重・運動の記録に見えても、 必ず recipe として解釈すること。 たとえ材料が 1 つでも recipe を返す。
- name に「カレー300kcal」のように kcal が併記されていてもそれは ingredient 側の補足情報なので、 quantity / unit には混ぜない (kcal は記録対象外)。

ユーザーへの返答はしない。JSONだけを返すこと。`

const RECIPE_FEW_SHOT_EXAMPLES = `以下の例を参考にしてください:

入力: ひき肉500gと玉ねぎ3個とトマト缶1個で5食分のカレーを作った
出力: {"kind":"recipe","name":"カレー","servings":5,"ingredients":[{"name":"ひき肉","quantity":500,"unit":"g"},{"name":"玉ねぎ","quantity":3,"unit":"個"},{"name":"トマト缶","quantity":1,"unit":"缶"}]}

入力: 鶏もも300g、ごはん2合、卵4個で3食分の親子丼
出力: {"kind":"recipe","name":"親子丼","servings":3,"ingredients":[{"name":"鶏もも","quantity":300,"unit":"g"},{"name":"ごはん","quantity":2,"unit":"合"},{"name":"卵","quantity":4,"unit":"個"}]}

入力: ひきにく500g、カレールゥ300kcal、たまねぎ3個、なす5本、ピーマン5個、パプリカ2個、しめじ100g、エリンギ100g、えのき100g、ホールトマト1缶 で無水カレー作った。これで5食か6食分
出力: {"kind":"recipe","name":"無水カレー","servings":5,"ingredients":[{"name":"ひき肉","quantity":500,"unit":"g"},{"name":"カレールゥ","quantity":1,"unit":"個"},{"name":"玉ねぎ","quantity":3,"unit":"個"},{"name":"なす","quantity":5,"unit":"本"},{"name":"ピーマン","quantity":5,"unit":"個"},{"name":"パプリカ","quantity":2,"unit":"個"},{"name":"しめじ","quantity":100,"unit":"g"},{"name":"エリンギ","quantity":100,"unit":"g"},{"name":"えのき","quantity":100,"unit":"g"},{"name":"ホールトマト","quantity":1,"unit":"缶"}]}`

export const buildRecipeSystemPrompt = () =>
  `${RECIPE_PARSER_SYSTEM_PROMPT}\n${getRecordSchemaPrompt()}\n${RECIPE_FEW_SHOT_EXAMPLES}\n/no_think`

// kind に応じた stage2 プロンプトを返す。 unknown は LLM を走らせない (null)。
//   - recipe は専用 system prompt (RECIPE_PARSER_SYSTEM_PROMPT) を使う。 2-stage 経路でも
//     既存の単発レシピプロンプトをそのまま流用する (recipe は元々 few-shot がしっかりしている)。
export const getStage2PromptFor = (kind) => {
  if (kind === 'food') return STAGE2_FOOD_PROMPT
  if (kind === 'weight') return STAGE2_WEIGHT_PROMPT
  if (kind === 'activity') return STAGE2_ACTIVITY_PROMPT
  if (kind === 'recipe') return buildRecipeSystemPrompt()
  return null
}

const makeDummyCardMessage = () => {
  const stamp = Date.now()
  return {
    _id: `local-card-${stamp}`,
    text: '',
    createdAt: new Date(stamp),
    user: ASSISTANT,
    foodItems: [
      { id: 'f1', name: 'ごはん', quantity: 150, unit: 'g', kcal: 252 },
      { id: 'f2', name: 'カツ丼', quantity: 1, unit: '人前', kcal: 893 },
      { id: 'f3', name: 'みそ汁', quantity: 1, unit: '杯', kcal: 40 },
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

// 2-stage parser 経路で localMessages に積む assistant 側カード IMessage 群。
// FoodCard / RecipeCard / WeightCard / ActivityCard が currentMessage の各フィールド
// (foodItems / recipe / weightRecord / activityRecord) で振り分けされるので、それぞれに
// 合わせて整形する。 _id は 'local-' プレフィックスで揃え、 編集ハンドラ側 (findFoodItemSnapshot
// など) はこのプレフィックスで localMessages 経路と llm.messageHistory 経路を判別する。
const synthFoodCardMessage = (foodItems, opts = {}) => {
  const stamp = Date.now()
  return {
    _id: `local-food-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    foodItems,
    ...(opts.truncated ? { truncated: true } : {}),
  }
}

const synthRecipeCardMessage = (recipe, opts = {}) => {
  const stamp = Date.now()
  return {
    _id: `local-recipe-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    recipe,
    ...(opts.truncated ? { truncated: true } : {}),
  }
}

const synthWeightCardMessage = (weightKg) => {
  const stamp = Date.now()
  return {
    _id: `local-weight-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    weightRecord: {
      initial_kg: weightKg,
      savedWeightLogId: undefined,
      savedSummary: undefined,
    },
  }
}

const synthActivityCardMessage = (payload) => {
  const stamp = Date.now()
  return {
    _id: `local-activity-${stamp}`,
    text: '',
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    activityRecord: {
      initial_name: payload.activity_name,
      initial_duration_min: payload.duration_min,
      initial_distance_km: payload.distance_km,
      initial_kcal: payload.estimated_kcal,
      met: payload.met,
      weight_kg_used: payload.weight_kg_used,
      savedEnergyLogId: undefined,
      savedSummary: undefined,
    },
  }
}

const synthParserErrorMessage = (errText) => {
  const stamp = Date.now()
  return {
    _id: `local-perror-${stamp}`,
    text: errText,
    createdAt: new Date(stamp + 1),
    user: ASSISTANT,
    isError: true,
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
// 入力テキストと parser 出力の name を照合し、 ハルシネーション (入力に無い品目を
// 勝手に追加) を弾く。 全角空白・スペース・「・」「-」などの記号は除いて比較する。
//   - userText に name が部分一致 → keep
//   - 入力に全く現れない (例: 入力「無水カレー一食」 に対して name「ごはん」) → drop
//   - userText 未指定なら無効化 (チェックスキップ)
const stripForMatch = (s) => String(s ?? '').replace(/[\s　・\-*・]/g, '').toLowerCase()
const isItemNameInUserInput = (itemName, userText) => {
  if (!userText) return true
  const n = stripForMatch(itemName)
  if (!n) return false
  const u = stripForMatch(userText)
  return u.includes(n)
}

// パース済み JSON オブジェクト → kind 別 enrichment (DB 検索 / kcal 計算 / mode 整合性)。
// parseRecordOutput や parseStage2Output で JSON 化された後の共通後処理を担う。
//   - idPrefix: foodItems[].id の prefix。 history index 経由なら "${idx}" 文字列、
//               localMessages 経由なら "local-${stamp}" のような stamp 文字列を渡す。
const enrichParsedRecord = async (parsedInput, { idPrefix, userText = '', mode = 'log' }) => {
  let parsed = parsedInput
  // レシピモードでは recipe 以外を受け付けない。 parser が誤って food などを
  // 返してきた場合は強制的にエラー扱いにし、 RecipeCard が誤生成されないようにする。
  if (mode === 'recipe' && parsed.kind !== 'recipe') {
    return {
      error:
        '材料リストとして解釈できませんでした。 「ひき肉500g 玉ねぎ3個 で5食分のカレー」のような書き方で送ってください。',
    }
  }
  // 記録モードでは recipe を受け付けない (RecipeCard はレシピモード専用)。
  //   - 記録モードの parser prompt から recipe ルール / few-shot は撤去したが、
  //     LFM2.5-JP 等のモデルは訓練バイアスで「カレー」のような既知レシピ名を
  //     入力すると稀に kind='recipe' を返してしまう。
  //   - そのまま渡すと RecipeCard が出てしまうので、 ユーザーは「カレーを 1 食食べた」
  //     つもりだった前提で {name, quantity:1, unit:'食'} の food に降格する。
  //   - 後段の food 経路で findBestFood が recipe マッチを拾い、 kcal_per_serving が
  //     正しく反映される。 ingredients は破棄 (材料登録は recipe モード専用)。
  if (mode === 'log' && parsed.kind === 'recipe') {
    parsed = {
      kind: 'food',
      items: [{ name: parsed.name, quantity: 1, unit: '食' }],
    }
  }
  if (parsed.kind === 'food') {
    try {
      // ハルシネーション除去: 入力に出てこない name の item を捨てる。
      // ユーザーが「無水カレー一食」とだけ書いたのに parser が
      // 「ごはん」「カレー」を返してきた場合、 「ごはん」は drop され
      // 「カレー」だけ残る (FoodCard 上で「無水カレー」に編集可能)。
      const filteredItems = parsed.items.filter((it) =>
        isItemNameInUserInput(it?.name, userText),
      )
      // userText が指定されていて、 かつ全件が入力に含まれない品目だった = LLM の完全ハルシネーション
      // (例: 「お腹すいた」 → LFM2.5 が few-shot 例の 「ごはん/バナナ/焼き魚」 を copy)。
      // ここで parsed.items にフォールバックすると誤データを food_log INSERT してしまうので、
      // unknown に倒して 「具体的に書いてください」 エラー表示に逃がす。
      // userText が空のとき (旧経路フォールバック) は isItemNameInUserInput が常に true を返すので
      // filteredItems = parsed.items となり、 ここには来ない。
      if (userText && filteredItems.length === 0) {
        return { kind: 'unknown' }
      }
      const enriched = await Promise.all(
        filteredItems.map(async (it, j) => {
          const matched = await findBestFood(it.name).catch((err) => {
            console.warn('[db] search failed for', it.name, err)
            return null
          })
          const computedKcal = computeKcalFromMatch(matched, it.quantity, it.unit, it.name)
          // DB ヒットを優先。無ければ LLM の estimated_kcal を採用 (どちらも無ければ null)。
          const kcal = computedKcal ?? it.estimated_kcal ?? null
          const kcalSource =
            computedKcal != null ? 'db' : it.estimated_kcal != null ? 'llm_estimate' : null
          return {
            id: `${idPrefix}-${j}`,
            name: it.name,
            quantity: it.quantity,
            unit: it.unit,
            kcal,
            kcalSource,
            matchedName: matched?.name ?? null,
            matchedFoodCode: matched?.food_code ?? null,
            matchedFoodId: matched?.id ?? null,
            matchedKind: matched?.kind ?? null,
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
  if (parsed.kind === 'recipe') {
    try {
      const enriched = await Promise.all(
        parsed.ingredients.map(async (ing, j) => {
          const matched = await findBestFood(ing.name).catch((err) => {
            console.warn('[db] recipe ingredient search failed for', ing.name, err)
            return null
          })
          // recipe 内のレシピマッチは無視 (材料に他レシピを混ぜる用途はサポート外)。
          // recipe マッチが来ても kcal_per_100g が null なので computeKcalFromMatch も null を返す。
          const ingKcal = computeKcalFromMatch(matched, ing.quantity, ing.unit, ing.name)
          return {
            id: `recipe-${idPrefix}-${j}`,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            kcal: ingKcal,
            kcalSource: ingKcal != null ? 'db' : null,
            matchedFoodId:
              matched && matched.kind !== 'recipe' ? matched.id : null,
            matchedName:
              matched && matched.kind !== 'recipe' ? matched.name : null,
          }
        }),
      )
      return {
        kind: 'recipe',
        recipe: {
          name: parsed.name,
          servings: parsed.servings,
          ingredients: enriched,
          saved: false,
          savedRecipeId: null,
        },
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

// 単発 LLM 出力 → enrich の従来経路。 llm.messageHistory 経由 (coach の assistant 行や
// VLM 経路など) で来た JSON 文字列を parse + enrich する。 parser 本実装は 2-stage に
// 移行したので、 これは coach モード以外では呼ばれなくなる予定 (旧フォールバック用)。
const parseAndDispatch = async (content, idx, mode = 'log', userText = '') => {
  let parsed
  try {
    parsed = parseRecordOutput(content)
  } catch (e) {
    return {
      error: e?.message ?? String(e),
      stages: {
        extracted: e?.extracted,
        repaired: e?.repaired,
        parsed: e?.parsed,
      },
    }
  }
  return enrichParsedRecord(parsed, { idPrefix: String(idx), userText, mode })
}

export default function Chat() {
  // VLM orchestrator が modelContext オブジェクト全体を必要とする
  // (preventLlmLoad を切り替えるため) ので、destructure と別に変数で持つ。
  const modelCtx = useActiveModel()
  const {
    activeModel,
    activeEngine,
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
  const [mode, setMode] = useState('log') // 'log' | 'coach' | 'recipe'

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
  const recipeHistoryRef = useRef([])
  const logCardsRef = useRef({})
  const recipeCardsRef = useRef({})
  const logLocalMessagesRef = useRef([])
  const coachLocalMessagesRef = useRef([])
  const recipeLocalMessagesRef = useRef([])
  const [modeBusy, setModeBusy] = useState(false)
  const llmTimestampsRef = useRef([])
  // configure useEffect が現サイクルで完了したか。
  // useLLM が再 init される (Settings でモデル変更 等) と isReady=false → true と遷移し、
  // この間 llm.messageHistory はモデル内部状態 ([] 等) になっている。
  // 「isReady=true だが configure 未実行」のスキマで sync が走ると、 空の messageHistory を
  // ref に書き戻してしまい、 続く configure が空の履歴を復元 → 履歴が消える。
  // configure 実行完了でこのフラグを立て、 isReady が落ちたら倒すことで sync を gate する。
  const configureDoneRef = useRef(false)
  const { showActionSheetWithOptions } = useActionSheet()

  // useLLM 再 init が始まった瞬間に configureDone を倒す。
  useEffect(() => {
    if (!llm.isReady) configureDoneRef.current = false
  }, [llm.isReady])

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
          mode === 'log'
            ? logHistoryRef.current
            : mode === 'recipe'
              ? recipeHistoryRef.current
              : coachHistoryRef.current
        let systemPrompt
        let temperature
        if (mode === 'coach') {
          const context = await buildCoachingContext()
          if (cancelled) return
          systemPrompt = buildCoachSystemPrompt(context)
          temperature = 0.5
        } else if (mode === 'recipe') {
          systemPrompt = buildRecipeSystemPrompt()
          temperature = 0.2
        } else {
          systemPrompt = buildSystemPrompt(activeEngine)
          temperature = 0.2
        }
        llm.configure({
          chatConfig: { systemPrompt, initialMessageHistory: restoreHist },
          generationConfig: { temperature },
        })
        // インデックスが復元履歴に合わせて変わるので、processed/persisted セットも合わせる。
        //   log/recipe: カードが既に手元にある index だけ「処理済み」扱い。
        //               カード生成が間に合わずモード切替が走ったケースで欠落していると、
        //               全 index を processed にしてしまうと再パース不能になる。
        //   coach: 復元される assistant 行は DB 保存済み扱い (二重保存防止)。
        const newProcessed = new Set()
        const newPersisted = new Set()
        const cardsRef = mode === 'recipe' ? recipeCardsRef : logCardsRef
        restoreHist.forEach((m, i) => {
          if (m.role !== 'assistant') return
          if (mode === 'coach') {
            newPersisted.add(i)
          } else if (cardsRef.current[i] !== undefined) {
            newProcessed.add(i)
          }
        })
        processedRef.current = newProcessed
        persistedCoachRef.current = newPersisted
        configureDoneRef.current = true
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

  // 現モードのスナップショット ref を継続同期する。
  //   以前は handleSetMode 内でしか ref を更新していなかったため、 一度もモード切替を
  //   していない状態で Settings からモデル変更 → useLLM 再 init が走ると、 configure
  //   useEffect が空の logHistoryRef.current で initialMessageHistory を上書きしてしまい
  //   会話履歴が消えるバグがあった。
  //   configureDoneRef による gate で「isReady=true だが configure 未実行」のスキマで
  //   空の messageHistory を書き戻すのを防いでいる。
  useEffect(() => {
    if (!llm.isReady) return
    if (modeBusy) return
    if (!configureDoneRef.current) return
    const currentHist = llm.messageHistory.filter((m) => m.role !== 'system')
    if (mode === 'log') {
      logHistoryRef.current = currentHist
      logCardsRef.current = llmCards
      logLocalMessagesRef.current = localMessages
    } else if (mode === 'recipe') {
      recipeHistoryRef.current = currentHist
      recipeCardsRef.current = llmCards
      recipeLocalMessagesRef.current = localMessages
    } else {
      coachHistoryRef.current = currentHist
      coachLocalMessagesRef.current = localMessages
    }
  }, [mode, llm.isReady, llm.messageHistory, llmCards, localMessages, modeBusy])

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
    // 2-stage parser 本実装 (4b) 以降、 parser モード (log / recipe) では llm.sendMessage を
    // 介さず llm.generate 直叩きで動くため、 ここで処理対象になる llm.messageHistory の
    // assistant 行は基本的に発生しない。 防御的に loop は残してあるが空回りする。
    const base = llm.messageHistory.filter((m) => m.role !== 'system')
    base.forEach((m, idx) => {
      if (m.role !== 'assistant') return
      if (processedRef.current.has(idx)) return
      processedRef.current.add(idx)
      ;(async () => {
        const userMsg = base[idx - 1]?.content
        console.log('========== Chat log ==========')
        console.log('[model]', activeModel.id)
        console.log('[engine]', activeModel.engine ?? 'unknown')
        console.log('[mode]', mode)
        if (userMsg) console.log('[USER]', userMsg)
        console.log('[LLM raw]', m.content)
        const result = await parseAndDispatch(m.content, idx, mode, userMsg ?? '')
        if (result.truncated) {
          console.log('[truncated] LLM 出力が生成上限で途中で切れた可能性あり')
        }
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
        } else if (result.kind === 'recipe' && result.recipe) {
          console.log('[parsed recipe]', JSON.stringify(result.recipe, null, 2))
          // recipe は保存ボタン押下時に DB へ書く。 ここでは llmCards に置くだけ。
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
          if (result.stages?.extracted !== undefined) {
            console.log('[extracted]', result.stages.extracted)
          }
          if (result.stages?.repaired !== undefined) {
            console.log('[repaired]', result.stages.repaired)
          }
          if (result.stages?.parsed !== undefined) {
            console.log('[parsed obj]', JSON.stringify(result.stages.parsed, null, 2))
          }
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
      } else if (card?.kind === 'recipe' && card.recipe) {
        items.push({
          _id: `h-${i}`,
          text: '',
          createdAt,
          user: ASSISTANT,
          recipe: card.recipe,
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
        // recipe モードでは parseRecordOutput / parseRecipeKind の内訳メッセージが
        // そのまま「材料が無い」「食数が抽出できない」など実用的なヒントになるので
        // 直接見せる。 log モードは parser 内部エラーが分かりにくいので generic に倒す。
        const errText =
          mode === 'recipe'
            ? card.error
            : '記録を抽出できませんでした。もう少し具体的に書いてみてください。'
        items.push({
          _id: `h-${i}`,
          text: errText,
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
      // VLM / OCR が走っている最中の切替は、 進行中の async 完了時の
      // setLocalMessages が新モード側の localMessages に混ざる原因になる。
      // parserReloading=true は VLM 直後の executorch 再ロード待ちで isReady が
      // 一瞬 true に戻る前のスキマを塞ぐため、 こちらでも弾く。
      if (visionBusy || ocrBusy || parserReloading) return
      setModeBusy(true)
      try {
        const currentHist = llm.messageHistory.filter((m) => m.role !== 'system')
        // 現在モードを保存
        if (mode === 'log') {
          logHistoryRef.current = currentHist
          logCardsRef.current = llmCards
          logLocalMessagesRef.current = localMessages
        } else if (mode === 'recipe') {
          recipeHistoryRef.current = currentHist
          recipeCardsRef.current = llmCards
          recipeLocalMessagesRef.current = localMessages
        } else {
          coachHistoryRef.current = currentHist
          coachLocalMessagesRef.current = localMessages
        }
        const restoreCards =
          newMode === 'log'
            ? logCardsRef.current
            : newMode === 'recipe'
              ? recipeCardsRef.current
              : {}
        const restoreLocalMessages =
          newMode === 'log'
            ? logLocalMessagesRef.current
            : newMode === 'recipe'
              ? recipeLocalMessagesRef.current
              : coachLocalMessagesRef.current
        setLlmCards(restoreCards)
        setLocalMessages(restoreLocalMessages)
        setInputText('')
        setMode(newMode)
        // ロール切替 → Provider 側で必要ならモデル swap
        // recipe モードは parser ロール (kcal 計算のため軽量モデルで十分)
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
    [
      mode,
      llm,
      llmCards,
      localMessages,
      modeBusy,
      currentRole,
      setCurrentRole,
      visionBusy,
      ocrBusy,
      parserReloading,
    ],
  )

  // ---- 2-stage parser 本実装 (4b: llm.sendMessage を介さず llm.generate 直叩き) ---
  // 設計:
  //   1. ルール分類器 (classifyByRules) で kind を決定 (LLM 不要、 0ms)
  //   2. kind 別の短い stage2 プロンプトで llm.generate() を 1 回叩く
  //   3. 結果を parseStage2Output → enrichParsedRecord でカード描画用 shape に変換
  //   4. 結果カード IMessage を localMessages に push (FoodCard / RecipeCard / WeightCard /
  //      ActivityCard / エラー文字列)
  // llm.messageHistory は触らないので、 parser のチャット履歴は localMessages 一本に統合。
  // sendMessage 経由の従来パス (parseAndDispatch + llmCards) は coach 専用に縮退する。
  //
  // mode='recipe' のときは kind を強制的に 'recipe' に固定する (RecipeCard 以外を出さない)。
  const runParserTwoStage = useCallback(
    async (text, currentMode) => {
      const kind = currentMode === 'recipe' ? 'recipe' : classifyByRules(text)
      const stage2Prompt = getStage2PromptFor(kind)
      console.log('========== Chat parser (2-stage) ==========')
      console.log('[model]', activeModel.id, '/', activeModel.engine ?? 'unknown')
      console.log('[mode]', currentMode)
      console.log('[USER]', text)
      console.log('[stage1/rule]', `kind=${kind}`)
      if (!stage2Prompt) {
        // unknown など LLM 不要の kind
        console.log('[stage2] skipped (kind has no prompt)')
        console.log('===========================================')
        return { kind: 'unknown' }
      }
      let stage2Out = ''
      try {
        const t2 = Date.now()
        const raw = await llm.generate([
          { role: 'system', content: stage2Prompt },
          { role: 'user', content: text },
        ])
        stage2Out = typeof raw === 'string' ? raw : String(raw ?? '')
        console.log('[stage2]', `${Date.now() - t2}ms`)
        console.log('[LLM raw]', stage2Out)
      } catch (e) {
        console.warn('[parser 2-stage] generate failed:', e?.message ?? e)
        console.log('===========================================')
        return { error: e?.message ?? String(e) }
      }
      let parsed
      try {
        parsed = parseStage2Output(stage2Out, kind)
      } catch (e) {
        console.warn('[parser 2-stage] parse failed:', e?.message ?? e)
        console.log('===========================================')
        return {
          error: e?.message ?? String(e),
          stages: {
            extracted: e?.extracted,
            repaired: e?.repaired,
            parsed: e?.parsed,
          },
        }
      }
      const result = await enrichParsedRecord(parsed, {
        idPrefix: `local-${Date.now()}`,
        userText: text,
        mode: currentMode,
      })
      console.log('[enriched]', JSON.stringify(result, null, 2))
      console.log('===========================================')
      return result
    },
    [llm, activeModel],
  )

  // 2-stage parser の結果 → localMessages 反映 + DB 副作用 (food_log insert)。
  // food は parseAndDispatch 旧経路と同じく即時 insertFoodLogItems して foodLogId を貼る。
  // weight / activity は WeightCard / ActivityCard のユーザー入力を待ってから保存するので
  // ここでは DB 書き込みしない (カードを置くだけ)。
  const handleParserResult = useCallback(async (result, currentMode) => {
    if (result.kind === 'food' && result.foodItems) {
      let foodItems = result.foodItems
      try {
        const insertedIds = await insertFoodLogItems(foodItems)
        foodItems = foodItems.map((it, j) => ({
          ...it,
          foodLogId: insertedIds[j] ?? null,
        }))
        const total = await countFoodLog()
        console.log(`[food_log] inserted ${insertedIds.length} rows (total ${total})`, insertedIds)
      } catch (e) {
        console.warn('[food_log] insert failed:', e?.message ?? e)
      }
      setLocalMessages((prev) => [
        ...prev,
        synthFoodCardMessage(foodItems, { truncated: result.truncated }),
      ])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      return
    }
    if (result.kind === 'recipe' && result.recipe) {
      setLocalMessages((prev) => [
        ...prev,
        synthRecipeCardMessage(result.recipe, { truncated: result.truncated }),
      ])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      return
    }
    if (result.kind === 'weight') {
      setLocalMessages((prev) => [...prev, synthWeightCardMessage(result.weight_kg)])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      return
    }
    if (result.kind === 'activity') {
      setLocalMessages((prev) => [...prev, synthActivityCardMessage(result)])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      return
    }
    if (result.kind === 'unknown') {
      setLocalMessages((prev) => [
        ...prev,
        synthParserErrorMessage(
          '食事・体重・運動のいずれにも判定できませんでした。書き方を変えて試してみてください。',
        ),
      ])
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      return
    }
    // error 経路
    const errText =
      currentMode === 'recipe'
        ? result.error || '材料リストとして解釈できませんでした。'
        : '記録を抽出できませんでした。もう少し具体的に書いてみてください。'
    setLocalMessages((prev) => [...prev, synthParserErrorMessage(errText)])
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
  }, [])

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

      if (mode === 'coach') {
        // コーチモードのみ、毎回最新の DB コンテキストで再 configure（履歴は維持）。
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
        llm.sendMessage(text)
        return
      }

      // 記録 / レシピモード = 2-stage parser 経路 (llm.sendMessage を経由しない)。
      //   - user message を即座に localMessages に積んでチャット UI を更新
      //   - llm.generate で stage2 を 1 回叩く (isGenerating が立つので isTyping も出る)
      //   - 結果に応じたカードを localMessages に追加
      setLocalMessages((prev) => [...prev, makeUserMessage(text)])
      const result = await runParserTwoStage(text, mode)
      await handleParserResult(result, mode)
    },
    [llm, mode, runParserTwoStage, handleParserResult],
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
              kcal: computedKcal,
              // VLM 経路は料理名のみで estimated_kcal を出さないので、'db' or null のみ。
              // DB ミス品の kcal 推定が必要なら EditFood の「AI推定」ボタンで個別に行う。
              kcalSource: computedKcal != null ? 'db' : null,
              matchedName: matched?.name ?? null,
              matchedFoodCode: matched?.food_code ?? null,
              matchedFoodId: matched?.id ?? null,
              matchedKind: matched?.kind ?? null,
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
    if (messageId.startsWith('local-')) {
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
    if (messageId.startsWith('local-')) {
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
    if (messageId.startsWith('local-')) {
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

  // FoodCard 上の編集 (料理名インライン編集 / 数量・kcal テンキー入力) の集約ハンドラ。
  //   - name 変更時は findBestFood で再マッチして kcal / matched* を更新する。
  //   - 数量変更時の kcal 自動スケールは呼び元 (FoodCard の NumericKeypadModal) で
  //     済ませてから patch.kcal として届く。 ここでは DB に流すだけ。
  //   - foodLogId が振られていれば food_log も UPDATE する。
  const updateFoodItem = useCallback(
    async (messageId, itemId, updates) => {
      const before = findFoodItemSnapshot(messageId, itemId)
      if (!before) return

      const patch = {}
      let nextName = before.name
      let nextQuantity = before.quantity ?? null
      let nextKcal = before.kcal ?? null
      let nextMatchedId = before.matchedFoodId ?? null
      let nextMatchedName = before.matchedName ?? null
      let nextMatchedCode = before.matchedFoodCode ?? null
      let nextMatchedKind = before.matchedKind ?? null
      let nextKcalSource = before.kcalSource ?? null

      if ('name' in updates) {
        const trimmed = (updates.name ?? '').trim()
        if (trimmed && trimmed !== before.name) {
          // updates.matchedFood が来ていればそれを使う (FoodNameInput のサジェスト
          // タップ経路)。 ユーザーが選んだ行 (Slism 完成料理など) を尊重し、
          // findBestFood の top-1 が別 food (mext 素材) を返して serving フォールバック
          // が効かなくなる事故を避ける。 手入力で変えた経路では matchedFood は無いので
          // 従来通り findBestFood で当てに行く。
          const matched = updates.matchedFood
            ? updates.matchedFood
            : await findBestFood(trimmed).catch((e) => {
                console.warn('[db] foodcard edit search failed:', e?.message ?? e)
                return null
              })
          nextName = trimmed
          nextKcal = computeKcalFromMatch(matched, before.quantity, before.unit, trimmed)
          nextMatchedId = matched?.id ?? null
          nextMatchedName = matched?.name ?? null
          nextMatchedCode = matched?.food_code ?? null
          nextMatchedKind = matched?.kind ?? null
          // 名前が変わったら元の LLM 推定値は破棄。 DB ヒットしたら 'db'、しなければ null。
          nextKcalSource = nextKcal != null ? 'db' : null
          patch.name = nextName
          patch.kcal = nextKcal
          patch.matchedFoodId = nextMatchedId
          patch.matchedName = nextMatchedName
          patch.matchedFoodCode = nextMatchedCode
          patch.matchedKind = nextMatchedKind
          patch.kcalSource = nextKcalSource
        }
      }
      // NumericKeypadModal からの数量 / kcal 直接編集。
      //   - quantity 変更は呼び元側で perUnitKcal を介して kcal も自動スケール済み。
      //     ここではどちらも届いたフィールドをそのまま反映する。
      //   - kcalSource は呼び元 (FoodCard) が 'manual' を立てるか null に倒すかを判断済み。
      if ('quantity' in updates) {
        nextQuantity = updates.quantity ?? null
        patch.quantity = nextQuantity
      }
      if ('kcal' in updates) {
        nextKcal = updates.kcal
        patch.kcal = nextKcal
      }
      if ('kcalSource' in updates) {
        nextKcalSource = updates.kcalSource ?? null
        patch.kcalSource = nextKcalSource
      }
      if (Object.keys(patch).length === 0) return

      applyFoodItemPatch(messageId, itemId, patch)

      if (before.foodLogId != null) {
        try {
          await updateFoodLogItem(before.foodLogId, {
            name: nextName,
            quantity: nextQuantity,
            kcal: nextKcal,
            matchedFoodId: nextMatchedId,
            matchedKind: nextMatchedKind,
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
  //   - そのカード内の kcal==null な item を全て集める
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
      if (messageId.startsWith('local-')) {
        foodItems = localMessagesRef.current.find((m) => m._id === messageId)?.foodItems
      } else if (messageId.startsWith('h-')) {
        const idx = Number(messageId.slice(2))
        foodItems = llmCardsRef.current[idx]?.foodItems
      }
      const targets = (foodItems ?? []).filter(
        (it) => it.kcal == null && it.name?.trim(),
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
              const patch = { kcal: result.kcal, kcalSource: 'llm_estimate' }
              applyFoodItemPatch(messageId, it.id, patch)
              if (foodLogId != null) {
                try {
                  await updateFoodLogItem(foodLogId, {
                    kcal: result.kcal,
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

  // RecipeCard 操作のヘルパ。 messageId の prefix で localMessages / llmCards を振り分ける。
  //   - 'h-<idx>'  → llmCards[idx].recipe (旧経路: llm.messageHistory 由来)
  //   - 'local-'   → localMessages[*].recipe (2-stage 経路: parser 出力直挿し)
  const findRecipeSnapshot = useCallback((messageId) => {
    if (messageId?.startsWith('local-')) {
      return localMessagesRef.current.find((m) => m._id === messageId)?.recipe ?? null
    }
    if (messageId?.startsWith('h-')) {
      const idx = Number(messageId.slice(2))
      return llmCardsRef.current[idx]?.recipe ?? null
    }
    return null
  }, [])

  const applyRecipePatch = useCallback((messageId, recipePatch) => {
    if (messageId?.startsWith('local-')) {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && m.recipe
            ? { ...m, recipe: { ...m.recipe, ...recipePatch } }
            : m,
        ),
      )
      return
    }
    if (messageId?.startsWith('h-')) {
      const idx = Number(messageId.slice(2))
      setLlmCards((prev) => {
        const entry = prev[idx]
        if (!entry?.recipe) return prev
        return {
          ...prev,
          [idx]: { ...entry, recipe: { ...entry.recipe, ...recipePatch } },
        }
      })
    }
  }, [])

  // ingredients 配列の map / filter を localMessages / llmCards 両対応で実行する。
  const applyRecipeIngredientsPatch = useCallback((messageId, transform) => {
    if (messageId?.startsWith('local-')) {
      setLocalMessages((prev) =>
        prev.map((m) =>
          m._id === messageId && m.recipe
            ? { ...m, recipe: { ...m.recipe, ingredients: transform(m.recipe.ingredients) } }
            : m,
        ),
      )
      return
    }
    if (messageId?.startsWith('h-')) {
      const idx = Number(messageId.slice(2))
      setLlmCards((prev) => {
        const entry = prev[idx]
        if (!entry?.recipe) return prev
        return {
          ...prev,
          [idx]: {
            ...entry,
            recipe: { ...entry.recipe, ingredients: transform(entry.recipe.ingredients) },
          },
        }
      })
    }
  }, [])

  const updateRecipeServings = useCallback(
    (messageId, n) => {
      applyRecipePatch(messageId, { servings: n })
    },
    [applyRecipePatch],
  )

  // 材料の数量を編集したら、 旧 kcal を新数量で線形スケールする。
  //   kcal = kcal_per_X * quantity の形なので比例計算で正しい。
  //   元 kcal=null (DB マッチなし) なら null のまま (「AI 推定」ボタンで補完)。
  const updateRecipeIngredientQuantity = useCallback(
    (messageId, ingId, qtyStr) => {
      const next = Number(qtyStr)
      if (!Number.isFinite(next) || next <= 0) return
      applyRecipeIngredientsPatch(messageId, (ings) =>
        ings.map((ing) => {
          if (ing.id !== ingId) return ing
          if (ing.quantity === next) return ing
          const scaled =
            ing.kcal != null && ing.quantity > 0
              ? Math.round((ing.kcal * next) / ing.quantity)
              : ing.kcal
          return { ...ing, quantity: next, kcal: scaled }
        }),
      )
    },
    [applyRecipeIngredientsPatch],
  )

  const deleteRecipeIngredient = useCallback(
    (messageId, ingId) => {
      applyRecipeIngredientsPatch(messageId, (ings) =>
        ings.filter((ing) => ing.id !== ingId),
      )
    },
    [applyRecipeIngredientsPatch],
  )

  // RecipeCard の「保存」ボタンハンドラ。 db/recipes.saveRecipe へ書き込み、
  // llmCards のエントリを saved=true にする。 以後の再利用は findBestFood が拾う。
  const [savingRecipeMessageId, setSavingRecipeMessageId] = useState(null)
  const handleSaveRecipe = useCallback(
    async (messageId) => {
      if (savingRecipeMessageId) return
      const recipe = findRecipeSnapshot(messageId)
      if (!recipe || recipe.saved) return
      const ings = recipe.ingredients ?? []
      if (ings.length === 0) {
        Alert.alert('保存できません', '材料が空です。')
        return
      }
      if (ings.some((ing) => ing.kcal == null)) {
        Alert.alert('保存できません', '「— kcal」の材料を AI 推定か手で確定してください。')
        return
      }
      const totalKcal = ings.reduce((sum, ing) => sum + (ing.kcal ?? 0), 0)
      setSavingRecipeMessageId(messageId)
      try {
        const recipeId = await saveRecipe({
          name: recipe.name,
          servings: recipe.servings,
          totalKcal,
          ingredients: ings.map((ing) => ({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
            matchedFoodId: ing.matchedFoodId ?? null,
            kcal: ing.kcal,
            kcalSource: ing.kcalSource ?? null,
          })),
        })
        applyRecipePatch(messageId, { saved: true, savedRecipeId: recipeId })
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      } catch (e) {
        console.warn('[recipe] save failed:', e?.message ?? e)
        Alert.alert('保存に失敗', e?.message ?? String(e))
      } finally {
        setSavingRecipeMessageId(null)
      }
    },
    [savingRecipeMessageId, applyRecipePatch, findRecipeSnapshot],
  )

  // RecipeCard の「AI 推定」ボタン。 ingredients の kcal=null を埋める。
  // handleEstimateMissingKcal とほぼ同じだが、 書き戻し先が foodItems ではなく
  // recipe.ingredients。
  const handleEstimateMissingRecipeKcal = useCallback(
    async (messageId) => {
      if (estimatingMessageId) return
      if (!llm || !llm.isReady || llm.isGenerating) {
        Alert.alert('AI モデルが準備中', '少し待ってから「AI推定」を押してください。')
        return
      }
      const recipe = findRecipeSnapshot(messageId)
      const ings = recipe?.ingredients ?? []
      const targets = ings.filter((ing) => ing.kcal == null && ing.name?.trim())
      if (targets.length === 0) return

      const originalRole = currentRole
      const needSwap = originalRole !== 'coach'
      setEstimatingMessageId(messageId)
      setEstimatingPhase(needSwap ? 'swapping' : 'generating')

      try {
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

        try {
          llmRef.current?.configure({
            generationConfig: { temperature: 0.1, repetitionPenalty: 1.1 },
          })
        } catch (e) {
          console.warn('[recipe ai kcal] configure (coach) failed:', e?.message ?? e)
        }

        await estimateKcalBatch(
          llmRef.current,
          targets.map((ing) => ({
            id: ing.id,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
          {
            modelLabel: coachModel?.id ?? 'coach',
            onItemDone: (it, result) => {
              if (!result.ok) return
              applyRecipeIngredientsPatch(messageId, (curIngs) =>
                curIngs.map((ing) =>
                  ing.id === it.id
                    ? { ...ing, kcal: result.kcal, kcalSource: 'llm_estimate' }
                    : ing,
                ),
              )
            },
          },
        )
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      } catch (e) {
        console.warn('[recipe ai kcal batch] failed:', e?.message ?? e)
        Alert.alert('AI推定に失敗', e?.message ?? String(e))
      } finally {
        if (needSwap) {
          setCurrentRole(originalRole).catch(() => {})
        }
        setEstimatingMessageId(null)
        setEstimatingPhase(null)
      }
    },
    [estimatingMessageId, llm, currentRole, setCurrentRole, coachModel, findRecipeSnapshot, applyRecipeIngredientsPatch],
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

  // チャット画面の表示履歴クリア。
  //   - LLM の internal history (messageHistory) を空にし、UI 側の派生 state も全部リセット
  //   - 現在モードの snapshot ref のみ空にする (もう一方のモードはタブ切替時に温存)
  //   - DB に保存済みの food_log / weight_log / energy_log / chat_messages は触らない
  //     (= 画面の「見え方」だけクリア。記録はそのまま残る)
  // 1.5 秒で消えるトースト ("コピーしました" 表示用)。 null は非表示。
  const [toast, setToast] = useState(null)
  const toastTimerRef = useRef(null)
  const showToast = useCallback((text) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(text)
    toastTimerRef.current = setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, 1500)
  }, [])
  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
  }, [])

  // チャットバブル長押しで本文をクリップボードへコピー。 カード (FoodCard/RecipeCard 等)
  // は独自の TouchableOpacity が touch を握っているので発火しない (= デフォルト Bubble の
  // テキスト/エラー/コーチ応答にのみ効く)。
  const handleCopyBubble = useCallback(
    async (text) => {
      const t = String(text ?? '').trim()
      if (!t) return
      try {
        await Clipboard.setStringAsync(t)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
        showToast('コピーしました')
      } catch (e) {
        console.warn('[chat] clipboard copy failed:', e?.message ?? e)
      }
    },
    [showToast],
  )
  const renderMessageText = useMemo(
    () => makeRenderMessageText(handleCopyBubble),
    [handleCopyBubble],
  )

  const handleClearHistory = useCallback(() => {
    if (llm.isGenerating || modeBusy) return
    if (visionBusy || ocrBusy || parserReloading) return
    Alert.alert(
      'チャット履歴をクリア',
      '画面に表示中の会話履歴をクリアします。記録済みの食事・体重・運動のデータは消えません。',
      [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: 'クリア',
          style: 'destructive',
          onPress: async () => {
            try {
              if (mode === 'log') {
                logHistoryRef.current = []
                logCardsRef.current = {}
                logLocalMessagesRef.current = []
              } else if (mode === 'recipe') {
                recipeHistoryRef.current = []
                recipeCardsRef.current = {}
                recipeLocalMessagesRef.current = []
              } else {
                coachHistoryRef.current = []
                coachLocalMessagesRef.current = []
              }
              processedRef.current = new Set()
              persistedCoachRef.current = new Set()
              llmTimestampsRef.current = []
              setLlmCards({})
              setLocalMessages([])
              setInputText('')
              let systemPrompt
              let temperature
              if (mode === 'coach') {
                const context = await buildCoachingContext()
                systemPrompt = buildCoachSystemPrompt(context)
                temperature = 0.5
              } else if (mode === 'recipe') {
                systemPrompt = buildRecipeSystemPrompt()
                temperature = 0.2
              } else {
                systemPrompt = buildSystemPrompt(activeEngine)
                temperature = 0.2
              }
              llm.configure({
                chatConfig: { systemPrompt, initialMessageHistory: [] },
                generationConfig: { temperature },
              })
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
            } catch (e) {
              console.warn('[chat] clear history failed:', e?.message ?? e)
            }
          },
        },
      ],
    )
  }, [mode, llm, modeBusy, visionBusy, ocrBusy, parserReloading])

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
      } else if (messageId.startsWith('local-')) {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m._id === messageId && m.weightRecord
              ? {
                  ...m,
                  weightRecord: {
                    ...m.weightRecord,
                    savedWeightLogId: id,
                    savedSummary: summary,
                  },
                }
              : m,
          ),
        )
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    },
    [],
  )

  // OCR 振り分け失敗時の手入力カードの「食事として記録」ハンドラ。
  //   kcal が null なら食品 DB 検索で kcal を補完。入力されていればそのまま使う。
  //   food_log に source='ocr_manual' で1行 INSERT。
  const handleUnknownOcrSave = useCallback(
    async (messageId, { name, quantity, unit, kcal }) => {
      let finalKcal = kcal
      let matched = null
      // kcal を手で入れた → 'manual'。空欄で DB 補完が当たった → 'db'。 どちらもなら null。
      let kcalSource = kcal != null ? 'manual' : null
      if (finalKcal == null) {
        matched = await findBestFood(name).catch((e) => {
          console.warn('[db] search failed:', e?.message ?? e)
          return null
        })
        finalKcal = computeKcalFromMatch(matched, quantity, unit, name)
        if (finalKcal != null) kcalSource = 'db'
      }
      const [id] = await insertFoodLogItems(
        [
          {
            name,
            quantity,
            unit,
            kcal: finalKcal,
            matchedFoodId: matched?.id ?? null,
            matchedKind: matched?.kind ?? null,
            kcalSource,
          },
        ],
        { source: 'ocr_manual' },
      )
      const summary = `${name} ${quantity}${unit}${
        finalKcal != null ? ` · ${finalKcal} kcal` : ''
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
      } else if (messageId.startsWith('local-')) {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m._id === messageId && m.activityRecord
              ? {
                  ...m,
                  activityRecord: {
                    ...m.activityRecord,
                    savedEnergyLogId: id,
                    savedSummary: summary,
                  },
                }
              : m,
          ),
        )
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
      if (current?.recipe) {
        return (
          <RecipeCard
            message={current}
            onChangeServings={updateRecipeServings}
            onChangeIngredientQuantity={updateRecipeIngredientQuantity}
            onDeleteIngredient={deleteRecipeIngredient}
            onSave={handleSaveRecipe}
            onEstimateMissing={handleEstimateMissingRecipeKcal}
            estimating={estimatingMessageId === current._id}
            estimatingPhase={estimatingMessageId === current._id ? estimatingPhase : null}
            saving={savingRecipeMessageId === current._id}
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
      return (
        <Bubble
          {...props}
          renderMessageText={renderMessageText}
        />
      )
    },
    [
      renderMessageText,
      updateFoodItem,
      deleteFoodItem,
      handleEstimateMissingKcal,
      estimatingMessageId,
      estimatingPhase,
      handleLabelSave,
      handleWeightSave,
      handleActivitySave,
      handleUnknownOcrSave,
      updateRecipeServings,
      updateRecipeIngredientQuantity,
      deleteRecipeIngredient,
      handleSaveRecipe,
      handleEstimateMissingRecipeKcal,
      savingRecipeMessageId,
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
      if (mode === 'recipe') {
        return (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              まとめて作った料理を登録できます。 材料リストと食数を送ると、 1食あたりの kcal を算出してマスタに保存します。
            </Text>

            <Text style={styles.sectionLabel}>🥘 一行で書く</Text>
            <View style={styles.exampleBlock}>
              <Text style={styles.exampleLine}>・ひき肉500gと玉ねぎ3個とトマト缶1個で5食分のカレー</Text>
              <Text style={styles.exampleLine}>・鶏もも300g、ごはん2合、卵4個で3食分の親子丼</Text>
            </View>

            <Text style={styles.sectionLabel}>📝 箇条書きでもOK</Text>
            <View style={styles.exampleBlock}>
              <Text style={styles.exampleLine}>・ひきにく500g</Text>
              <Text style={styles.exampleLine}>・カレールゥ300kcal</Text>
              <Text style={styles.exampleLine}>・たまねぎ3個</Text>
              <Text style={styles.exampleLine}>・なす5本</Text>
              <Text style={styles.exampleLine}>...</Text>
              <Text style={styles.exampleLine}>で無水カレー作った。これで5食か6食分</Text>
            </View>
            <Text style={styles.captionText}>
              「N食か N食分」のように幅があれば少ない方が食数に採用されます (後で編集可)。
            </Text>

            <Text style={styles.captionText}>
              保存後は記録モードで「カレー1食」のように呼び出して食事ログに記録できます。
            </Text>
          </View>
        )
      }
      return (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>
            食事・体重・運動を送ると、自動で分解してカードにします。
          </Text>
          <Text style={styles.emptyHowTo}>👇 たとえば、こんなふうに入力してください</Text>

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

          <Text style={styles.emptyHintDev}>`/card` でサンプル食品カードを表示</Text>
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
        placeholder={
          mode === 'coach'
            ? '入力例: 今週どうだった？（自由に質問できます）'
            : mode === 'recipe'
              ? '入力例: ひき肉500gと玉ねぎ3個で5食分のカレー'
              : '入力例: カツ丼と缶チューハイ2本 / 体重68.5kg / ランニング60分'
        }
        isTyping={llm.isGenerating || parserReloading}
        minComposerHeight={48}
        renderMessage={renderWideMessage}
        renderBubble={renderBubble}
        renderActions={mode === 'log' ? renderActions : undefined}
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
              {(() => {
                const modeSwitchDisabled =
                  modeBusy || llm.isGenerating || visionBusy || ocrBusy || parserReloading
                const clearDisabled = modeSwitchDisabled || messages.length === 0
                return (
                  <>
                    <TouchableOpacity
                      onPress={() => handleSetMode('log')}
                      disabled={modeSwitchDisabled}
                      style={[
                        styles.modeBtn,
                        mode === 'log' && styles.modeBtnActive,
                        modeSwitchDisabled && styles.modeBtnDisabled,
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
                      onPress={() => handleSetMode('recipe')}
                      disabled={modeSwitchDisabled}
                      style={[
                        styles.modeBtn,
                        mode === 'recipe' && styles.modeBtnActive,
                        modeSwitchDisabled && styles.modeBtnDisabled,
                      ]}
                      activeOpacity={0.7}
                    >
                      <FontIcon
                        name="cutlery"
                        size={12}
                        color={mode === 'recipe' ? colors.white : colors.darkPurple}
                      />
                      <Text
                        style={[styles.modeBtnText, mode === 'recipe' && styles.modeBtnTextActive]}
                      >
                        レシピ
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleSetMode('coach')}
                      disabled={modeSwitchDisabled}
                      style={[
                        styles.modeBtn,
                        mode === 'coach' && styles.modeBtnActive,
                        modeSwitchDisabled && styles.modeBtnDisabled,
                      ]}
                      activeOpacity={0.7}
                    >
                      <FontIcon
                        name="comments-o"
                        size={12}
                        color={mode === 'coach' ? colors.white : colors.darkPurple}
                      />
                      <Text
                        style={[styles.modeBtnText, mode === 'coach' && styles.modeBtnTextActive]}
                      >
                        コーチに聞く
                      </Text>
                    </TouchableOpacity>
                    {modeBusy && (
                      <ActivityIndicator
                        size="small"
                        color={colors.lightPurple}
                        style={{ marginLeft: 8 }}
                      />
                    )}
                    <TouchableOpacity
                      onPress={handleClearHistory}
                      disabled={clearDisabled}
                      style={[styles.clearBtn, clearDisabled && styles.modeBtnDisabled]}
                      activeOpacity={0.7}
                      accessibilityLabel="チャット履歴をクリア"
                    >
                      <FontIcon name="trash-o" size={14} color={colors.darkPurple} />
                    </TouchableOpacity>
                  </>
                )
              })()}
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
      {toast ? (
        <View pointerEvents="none" style={styles.toastWrap}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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
  toastWrap: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(40, 30, 60, 0.9)',
  },
  toastText: {
    color: colors.white,
    fontSize: fontSize.small,
    fontWeight: '600',
  },
  modeBtnDisabled: {
    opacity: 0.5,
  },
  clearBtn: {
    marginLeft: 'auto',
    width: 32,
    height: 32,
    borderRadius: 14,
    backgroundColor: '#e5e2f0',
    alignItems: 'center',
    justifyContent: 'center',
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
  emptyHowTo: {
    fontSize: fontSize.small,
    color: colors.lightPurple,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: -8,
    marginBottom: 14,
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
