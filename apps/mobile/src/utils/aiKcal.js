// AI による料理 kcal 推定の共通ユーティリティ。
//
// 用途:
//   - EditFoodScreen の「AI推定」ボタン (1 件)
//   - Chat の FoodCard 「AI推定」ボタン (VLM パスで DB ミスした複数件をまとめて)
//
// 設計方針:
//   - LLM への問い合わせは「1 料理 = 1 整数」形式に統一 (JSON マップ等は 0.6B では崩れやすい)
//   - 複数料理を推定する場合は逐次呼び出し (バッチ JSON より失敗時のリカバリが容易)
//   - <think>...</think> ブロックを除去してから数字を抜く (Qwen3 系は /no_think でも稀に漏らす)
//   - 値域 1〜2000 のみ採用 (それ以外は null = 推定失敗扱い)

// 設計上の注意:
// 1) プロンプト末尾に「例: 250」のような具体例を置くと、小型 LLM (Qwen3-0.6B) は料理が何であっても
//    例値をそのまま返す (VLM での例値転記と同じ現象)。例は絶対に置かず、形式の説明のみに留める。
// 2) CoT (think) を許容すると executorch の max_seq_len で途中切断され、結論が出る前に終わる
//    (実測: coach 1.7B クラスでも家系ラーメンの推論で 4000+ token 消費して未完結)。
//    途中の数値 (例: 思考中の「だいたい 200〜250 になりそう」) を最終答えと誤認すると致命的。
//    → `/no_think` で CoT を抑制し、最初の行に「答え: 〈整数〉」を書かせる方式に変更。
//    こうすれば max_seq_len 内に必ず収まり、回答位置も先頭固定で安定する。
// カテゴリ別の典型 kcal レンジを anchor として提供する。
//   - 1.7B クラスでも /no_think だと「家系ラーメン → 100」「ナン → 100」のように雑に小さい数値を返す
//     (モデル自身の知識が浅いため)。
//   - レンジを示すことで「ラーメン系なら最低 400」「丼物なら 600 以上」と下駄を履かせられる。
//   - 具体的な料理名や値を例示しないので、 VLM で起きた「例値そのまま転記」は発生しない。
// LLM が失敗した (フォーマット崩れ / 中国語ドリフト / 推定不能) ときの保険として、
// 料理名のキーワードからカテゴリを推定し、レンジ中央値を返すフォールバック表。
// 順序が重要 (より具体的なキーワードを先に置く):
//   - 「カレーパン」は「カレー」より先にマッチさせるべき (パン類: 375) → カレーパンは現状カレー扱いになるが
//     パン類の上限と差が大きくないので許容。
//   - 「親子丼」「カツ丼」は「丼」で 1 つにまとめる (丼物 中央値 775)
// 各カテゴリの妥当範囲 (low/high) と中央値 (mid)。LLM 結果のサニティチェックにも使う。
const CATEGORY_FALLBACKS = [
  { pattern: /ラーメン|らーめん|拉麺|つけ麺/, low: 600, high: 1200, mid: 900, label: 'ラーメン類' },
  { pattern: /カレー|かれー/, low: 600, high: 900, mid: 750, label: 'カレー類' },
  { pattern: /丼|どんぶり/, low: 600, high: 950, mid: 775, label: '丼物' },
  // ファストフード系: バーガー / ナゲット / ホットドッグ / タコス / フライドチキン
  //   - レシート/注文履歴 VLM 経路で頻出 (マック・モス・ケンタ等)。
  //   - バーガー単品: ハンバーガー 250 / チーズバーガー 310 / エグチ 390 / ビッグマック 525 程度。
  //   - 「フライドチキン」は揚げ物より先にマッチさせる (鳥フライではないため)。
  //   - 「サンド」はパン類で先に拾うが、「クラブハウスサンド」のような単品もあり得るのでこちらにも置かない。
  { pattern: /バーガー|ナゲット|ホットドッグ|ホットドック|タコス|フライドチキン|チキンナゲット/, low: 250, high: 650, mid: 450, label: 'ファストフード' },
  { pattern: /唐揚げ|から揚げ|天ぷら|コロッケ|フライ|揚げ物|揚げ/, low: 300, high: 600, mid: 450, label: '揚げ物' },
  { pattern: /ステーキ|ハンバーグ|焼肉|カルビ|ロース|生姜焼き|豚カツ|とんかつ/, low: 350, high: 700, mid: 525, label: '定食肉' },
  { pattern: /焼き魚|焼魚|塩鮭|鯖|さば|さんま|秋刀魚|アジ|鯵|鰈|刺身/, low: 200, high: 400, mid: 300, label: '定食魚' },
  { pattern: /うどん|そば|パスタ|スパゲ|焼きそば|焼そば|やきそば|ペペロンチーノ|そうめん/, low: 350, high: 700, mid: 525, label: '麺類' },
  { pattern: /ナン|ピザ|サンド|ベーグル|フォカッチャ/, low: 250, high: 500, mid: 375, label: 'パン類' },
  { pattern: /みそ汁|味噌汁|スープ|お吸い物|汁/, low: 30, high: 100, mid: 65, label: '汁物' },
  { pattern: /サラダ|煮物|お浸し|おひたし|漬物|和え|ナムル/, low: 50, high: 200, mid: 125, label: '副菜' },
  { pattern: /ジュース|ビール|コーラ|牛乳|サイダー|ハイボール|ワイン/, low: 100, high: 250, mid: 175, label: '飲み物' },
  { pattern: /ご飯|ごはん|白米|食パン|パン|おにぎり/, low: 150, high: 300, mid: 225, label: '主食' },
]

// 料理名にキーワードがあれば、そのカテゴリ情報 (low/high/mid/label) を返す。なければ null。
// 後方互換: 戻り値の `kcal` フィールドに mid を入れておく (古い呼び出し用)。
export const kcalFromKeyword = (name) => {
  if (!name) return null
  const s = String(name).trim()
  for (const c of CATEGORY_FALLBACKS) {
    if (c.pattern.test(s)) {
      return { kcal: c.mid, low: c.low, high: c.high, mid: c.mid, category: c.label }
    }
  }
  return null
}

// 1.7B クラスのモデルは /no_think だと知識不足で雑な小値 (家系ラーメン→100) を返し、
// 一方でレンジを与えると「600〜1200」と範囲をそのまま転記してしまう。
// 解決: 短い CoT (1〜2文の思考) を許容しつつ、 (a) 整数 1 つだけを選ぶこと、
// (b) レンジや「〜」は禁止、 (c) 答えは <answer>N</answer> で囲む、と明示する。
// <answer> タグは executorch でも tokenize 上問題なく、 parser から確実に抽出できる。
// 1.7B は判断に迷うと「どれを選ぶか」を何度も繰り返して max_seq_len まで考え続ける。
// 速度向上のために (a) 即決を強く要求、 (b) 同じ事を 2 度書かない、 (c) 即時 <answer> 出力、を明示する。
// repetitionPenalty を per-call で設定する API がない (configure は chatConfig もリセットするため
// 副作用大) ので、プロンプト側で抑制する。
// 食材 (ingredient) モード用プロンプト。 完成料理ではなく、 自炊レシピの材料
// (ホールトマト 1 缶、 ひき肉 500g、 油 大さじ 1 など) を扱う。 meal プロンプトの
// レンジ (ラーメン 600〜1200 等) を流用すると、 該当カテゴリが無い食材で
// モデルが消去法でラーメン枠を吐く事故が起きるため完全に別系統。
//
// 設計:
//   - 「1 人前」 ではなく「指定された分量の総 kcal」 を出させる (qty×unit を読ませる)
//   - カテゴリは「per 100g」「per 缶」「per 大さじ」 など単位込みで提示
//     (LLM が単位換算しなくても済むように具体例で固定する)
//   - レンジ表記 (n〜m) は禁止 (parseKcal 側でも mode=ingredient では中央値救済を切る)
const INGREDIENT_SYSTEM_PROMPT =
  'あなたは食材の kcal 推定の専門家で、 答えを即決します。 食材名と分量を受け取り、 その分量の合計 kcal を整数で答えます。\n\n'
  + '参考の典型値 (1単位あたり):\n'
  + '- 生野菜 (キャベツ・大根・なす・ピーマン・パプリカなど): 100g ≒ 20〜40 kcal、 1 個 ≒ 30〜80 kcal\n'
  + '- 葉物野菜 (レタス・ほうれん草・しめじ・えのき): 100g ≒ 15〜25 kcal\n'
  + '- いも類 (じゃがいも・さつまいも): 100g ≒ 70〜130 kcal\n'
  + '- 缶詰野菜 (ホールトマト缶・コーン缶): 1 缶 (約 400g) ≒ 80〜150 kcal\n'
  + '- 缶詰魚 (ツナ缶・サバ缶): 1 缶 ≒ 150〜300 kcal\n'
  + '- 肉類 生 (鶏むね・豚バラ・牛・ひき肉): 100g ≒ 110〜380 kcal\n'
  + '- 魚 生: 100g ≒ 100〜200 kcal\n'
  + '- 卵: 1 個 (約 60g) ≒ 90 kcal\n'
  + '- 油類 (サラダ油・オリーブ油・ごま油): 大さじ 1 (12g) ≒ 110 kcal、 100g ≒ 900 kcal\n'
  + '- バター: 10g ≒ 75 kcal\n'
  + '- 砂糖: 大さじ 1 (9g) ≒ 35 kcal\n'
  + '- 米 (生): 100g ≒ 350 kcal\n'
  + '- 小麦粉: 100g ≒ 360 kcal\n'
  + '- 麺類 乾麺 (パスタ・うどん乾麺): 100g ≒ 350 kcal\n'
  + '- 牛乳: 200ml ≒ 130 kcal\n'
  + '- 調味料 (醤油・味噌・酒・みりん): 大さじ 1 ≒ 10〜35 kcal\n'
  + '- 固形ルウ・コンソメ (カレールゥ・コンソメ): 1 個分 ≒ 50〜120 kcal\n\n'
  + 'やり方: 食材を分類 → 該当する単位あたり kcal を取得 → 指定分量で掛け算 → 整数 1 つを出力。\n\n'
  + '出力ルール (厳守、 違反は禁止):\n'
  + '1. <think> 内は 1 文だけで「分類 X、 1 単位 N kcal × 数量 → 答え M」と書き、 すぐ </think> で閉じる\n'
  + '2. </think> 直後に <answer>M</answer> の 1 行だけを書く\n'
  + '3. 「〜」「範囲」「kcal」の文字、 英語、 中国語、 説明文、 改行は禁止 (日本語のみ使用)\n'
  + '4. 答えは整数 1 つだけ。 範囲を返さない。'

const buildIngredientUserPrompt = (name, qty, unit) =>
  `${name.trim()} ${qty}${unit.trim()} は合計で何 kcal? 即答してください。`

const SYSTEM_PROMPT =
  'あなたは日本食のカロリー推定の専門家で、答えを即決します。料理名と分量を受け取り、1人前あたりの kcal を答えます。\n\n' +
  '参考カテゴリ別レンジ (1人前、必ずこのレンジから整数を1つ選ぶ):\n' +
  '- ラーメン類 (家系・豚骨・味噌・醤油など): 600〜1200\n' +
  '- 麺類 (うどん・そば・パスタ・焼きそば): 350〜700\n' +
  '- 丼物 (カツ丼・牛丼・親子丼・中華丼・天丼): 600〜950\n' +
  '- 定食メイン肉 (焼肉・ステーキ・ハンバーグ): 350〜700\n' +
  '- 定食メイン魚: 200〜400\n' +
  '- カレー類 (カレーライス・バターチキンカレー): 600〜900\n' +
  '- 揚げ物 (唐揚げ・天ぷら・コロッケ): 300〜600\n' +
  '- 主食単体 (ご飯1杯・パン1切れ): 150〜300\n' +
  '- パン類 (ナン・ピザ・サンドイッチ): 250〜500\n' +
  '- ファストフード (ハンバーガー・ナゲット・ホットドッグ): 250〜650\n' +
  '- 汁物 (みそ汁・スープ): 30〜100\n' +
  '- 副菜 (サラダ・煮物・お浸し): 50〜200\n' +
  '- 飲み物 (ジュース・ビール): 100〜250\n\n' +
  '迷ったらレンジの中央値を機械的に選びます。\n\n' +
  '出力ルール (厳守、違反は禁止):\n' +
  '1. <think> 内は 1 文だけで「カテゴリは X、答えは N」と書き、すぐ </think> で閉じる\n' +
  '2. </think> 直後に <answer>N</answer> の 1 行だけを書く\n' +
  '3. 同じことを 2 回書かない。「どれを選ぶか」「迷う」と書かない、即決する\n' +
  '4. 「〜」「範囲」「kcal」の文字、英語、中国語、説明文、改行は禁止 (日本語のみ使用)'

const buildUserPrompt = (name, qty, unit) =>
  `${name.trim()} ${qty}${unit.trim()} は何 kcal? 即答してください。`

// 出力から kcal を抽出。
//  - 最優先: <answer>N</answer> タグ — プロンプトで指示している形式
//  - 次点: 「答え: N」 (互換)
//  - 次点: 「N〜M」レンジが含まれている場合は中央値 — 1.7B がプロンプトのレンジをそのまま転記する事例があった
//  - 閉じていない <think> を含む場合: CoT 途中で max_seq_len に当たって切断 → null
// mode='ingredient' は meal とフォールバック戦略を変える:
//   - meal は「<answer> → 答え: → range中央値 → 最初の数字」
//   - ingredient は「<answer> → 答え: → range中央値 → 最後の数字 (qty 除外)」
//
// 違いの理由:
//   1) ingredient の出力は category prompt のレンジを echo しがちで、 中央値の方が
//      実値に近い (ホールトマト 80〜150 → 115、 カレールゥ 50〜120 → 85)。
//      よって range 中央値は ingredient でも有効化する。
//   2) ingredient プロンプトは「<分量> は合計で何 kcal?」 と聞くため、 LLM の応答に
//      ユーザー入力の数字 ("3個"、 "5本") が混ざりやすい。 「最初の数字」 を取ると
//      その qty を答えと誤認するので、 ingredient では「最後の数字」 かつ
//      excludeNums で qty を弾く。
//      例: "100g ≒ 40 kcal、5本で 200kcal" → qty=5 除外、 末尾 200 を採用。
const parseKcal = (raw, { mode = 'meal', excludeNums = [] } = {}) => {
  const text = String(raw ?? '')
  // <think>...</think> ペアを除去 (まず正常な閉じタグを取り除く)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!stripped) return null
  // 閉じてない <think> が残っている → CoT 途中切断
  if (/<think>/i.test(stripped) && !/<\/think>/i.test(stripped)) return null
  // 1) <answer>N</answer> 最優先
  const ansTag = stripped.match(/<answer>\s*(\d+)\s*<\/answer>/i)
  if (ansTag) {
    const n = parseInt(ansTag[1], 10)
    if (Number.isFinite(n) && n > 0 && n <= 2000) return n
  }
  // 2) 「答え: N」
  const answerMatch = stripped.match(/(?:答え|答|answer)\s*[:：]?\s*(\d+)/i)
  if (answerMatch) {
    const n = parseInt(answerMatch[1], 10)
    if (Number.isFinite(n) && n > 0 && n <= 2000) return n
  }
  if (mode === 'ingredient') {
    // ingredient mode (a): まず「答えは N」 「整数で答えると N」 「結論は N」 などの
    // anchor marker を末尾優先で探す。 これらは LLM が「最終結論」 を宣言した
    // シグナルなので、 直前のレンジより信頼度が高い。
    //   例: "... 400〜650 kcal。整数で答えると 500"
    //     → marker "整数で答えると 500" を採用 (前段の range を拾わない)
    const markerRe = /(?:答えは|答えは約|整数で答えると|結論は?|結果は?|したがって|よって)\s*[:：]?\s*[*＊]*\s*(\d+)/gi
    const markers = [...stripped.matchAll(markerRe)]
    if (markers.length > 0) {
      const last = markers[markers.length - 1]
      const n = parseInt(last[1], 10)
      if (Number.isFinite(n) && n > 0 && n <= 2000) return n
    }
    // ingredient mode (b): 「N kcal」 「N〜M kcal」 の最後のマッチを優先する。
    // 理由: 説明文の末尾に最終答えが書かれる傾向が強い。
    //   "ピーマン ... 30 × 5 = 150 kcal" → 末尾 "150 kcal" を取る
    //   "パプリカ 1個 ≒ 80〜150 kcal、 2個は 160〜300 kcal" → 末尾 "160〜300 kcal" の中央値 230
    //   "ホールトマト ... 80〜150 kcal" → 中央値 115
    const kcalMatches = [...stripped.matchAll(/(\d+)(?:\s*[〜～~\-–—]\s*(\d+))?\s*kcal/gi)]
    if (kcalMatches.length > 0) {
      const last = kcalMatches[kcalMatches.length - 1]
      if (last[2]) {
        const lo = parseInt(last[1], 10)
        const hi = parseInt(last[2], 10)
        if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0 && lo <= 2000 && hi <= 2000 && hi >= lo) {
          return Math.round((lo + hi) / 2)
        }
      } else {
        const n = parseInt(last[1], 10)
        if (Number.isFinite(n) && n > 0 && n <= 2000) return n
      }
    }
    // kcal 修飾が一切ないケース ("1100" だけ等) → qty 除外して最後の数字
    const excludeStrs = new Set(excludeNums.map((n) => String(n)))
    const allMatches = stripped.match(/\d+/g) ?? []
    const candidates = allMatches
      .filter((s) => !excludeStrs.has(s))
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 2000)
    if (candidates.length > 0) return candidates[candidates.length - 1]
    return null
  }

  // meal mode: 既存ロジック (3=range中央値 → 4=最初の数字)
  // 3) 「N〜M」レンジ → 中央値 (1.7B のプロンプト echo 救済)
  const rangeMatch = stripped.match(/(\d+)\s*[〜～~\-–—]\s*(\d+)/)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0 && lo <= 2000 && hi <= 2000 && hi >= lo) {
      return Math.round((lo + hi) / 2)
    }
  }
  // 4) フォールバック: 最初の数字
  const firstNum = stripped.match(/\d+/)
  if (firstNum) {
    const n = parseInt(firstNum[0], 10)
    if (Number.isFinite(n) && n > 0 && n <= 2000) return n
  }
  return null
}

// 1 件推定。 EditFood と Chat の両方から呼ばれる。
//   llm: useActiveLLM() の戻り値
//   入力検証や busy 管理は呼び出し側の責任
//
// 戦略 (LLM 優先 + キーワードでサニティチェック):
//   1) LLM 呼び出し → 値が取れたら、キーワードヒット時はそのカテゴリ範囲内かチェック
//   2a) LLM 値 ∈ カテゴリ範囲 → LLM 採用 (料理ごとの微妙な差を活かせる)
//   2b) LLM 値 ∉ カテゴリ範囲 → LLM 破棄、カテゴリ中央値を採用 (prompt injection や言語ドリフト対策)
//   3) LLM 失敗 + キーワードヒット → カテゴリ中央値
//   4) LLM 失敗 + キーワードなし → エラー
//
// 戻り値: { ok: true, kcal, source } | { ok: false, error }
// mode:
//   'meal' (既定)      : 完成料理 (1 人前) 推定。 keyword fallback / range-midpoint 救済あり
//   'ingredient'        : 自炊レシピの材料 (1 缶, 100g 等) 推定。 専用プロンプト、
//                          keyword fallback 無し (meal カテゴリは食材に合わない)、
//                          range-midpoint 救済も切る
export const estimateKcalForFood = async (
  llm,
  { name, quantity, unit, modelLabel, mode = 'meal' } = {},
) => {
  if (!name?.trim()) return { ok: false, error: '食品名が空です' }
  if (!unit?.trim()) return { ok: false, error: '単位が空です' }
  if (!llm || !llm.isReady || llm.isGenerating) {
    return { ok: false, error: 'AI モデルがまだ準備中です' }
  }
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  const isIngredient = mode === 'ingredient'
  const messages = [
    {
      role: 'system',
      content: isIngredient ? INGREDIENT_SYSTEM_PROMPT : SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: isIngredient
        ? buildIngredientUserPrompt(name, qty, unit)
        : buildUserPrompt(name, qty, unit),
    },
  ]
  // ingredient モードでは meal 用キーワード表は使わない (ホールトマトを「サラダ」
  // にマッチさせて副菜中央値 125 を返すような誤フォールバックを防ぐ)
  const keyword = isIngredient ? null : kcalFromKeyword(name)
  console.log('========== AI kcal estimate ==========')
  console.log('[mode]', mode)
  console.log('[name]', name)
  console.log('[model]', modelLabel ?? '(unknown)')
  console.log('[keyword]', keyword ? `${keyword.category} (${keyword.low}〜${keyword.high})` : '(none)')
  console.log('[messages]', JSON.stringify(messages, null, 2))
  try {
    const raw = await llm.generate(messages)
    console.log('[raw]', raw)
    // ingredient モード: 出力にユーザー入力 qty が混ざる ("3個" の 3 等) ので
    // パーサ側で除外。 「3」 を除外しても「30」 「300」 は別文字列なので残る。
    const llmKcal = parseKcal(raw, {
      mode,
      excludeNums: isIngredient ? [qty] : [],
    })

    if (llmKcal != null) {
      // キーワードがあれば LLM 値の妥当性をチェック
      if (keyword) {
        if (llmKcal >= keyword.low && llmKcal <= keyword.high) {
          console.log('[result]', llmKcal, `kcal (llm, in ${keyword.category} range)`)
          console.log('======================================')
          return { ok: true, kcal: llmKcal, source: 'llm' }
        }
        console.log('[result]', keyword.mid, `kcal (fallback: ${keyword.category}, llm=${llmKcal} out of range)`)
        console.log('======================================')
        return { ok: true, kcal: keyword.mid, source: 'fallback', category: keyword.category }
      }
      // キーワードなし → LLM 値をそのまま採用
      console.log('[result]', llmKcal, 'kcal (llm, no keyword to validate)')
      console.log('======================================')
      return { ok: true, kcal: llmKcal, source: 'llm' }
    }

    // LLM が値を返さなかった → キーワードあればフォールバック
    if (keyword) {
      console.log('[result]', keyword.mid, `kcal (fallback: ${keyword.category}, llm rejected)`)
      console.log('======================================')
      return { ok: true, kcal: keyword.mid, source: 'fallback', category: keyword.category }
    }
    console.log('[result] rejected (no LLM value, no keyword match)')
    console.log('======================================')
    return {
      ok: false,
      error: `AI から有効な値を取得できませんでした (応答: ${String(raw ?? '').slice(0, 40)}…)`,
    }
  } catch (err) {
    console.warn('[ai kcal] generate failed:', err)
    // 例外時もキーワードあればフォールバック
    if (keyword) {
      console.log('[result]', keyword.mid, `kcal (fallback: ${keyword.category}, llm error)`)
      console.log('======================================')
      return { ok: true, kcal: keyword.mid, source: 'fallback', category: keyword.category }
    }
    console.log('======================================')
    return { ok: false, error: err?.message ?? String(err) }
  }
}

// 食品の「1 単位」 として自然な単位を 1 つ推定する。 ProductEditScreen の
// 「1 単位の表示」 欄から呼ばれる。
//   入力: 食品名のみ (kcal や数量は不要)
//   出力: 候補リストから選ばれた 1 つの単位文字列、 または null
//
// 候補は記録モード / レシピ材料で実際によく使われるものに絞る。 候補外を返した
// ときは「個」 にフォールバックせず null (= 推定失敗) を返し、 UI 側で Alert する。
const ALLOWED_UNITS = ['個', '袋', '本', '枚', '缶', '杯', '切れ', '玉', 'パック', 'g', 'mL']

// LFM2.5-1.2B-JP は <think> タグや構造化タグを使わず自然文で短く返す傾向が強い。
// CoT を仕込もうとすると「1 単位」 とだけ吐いて止まることがあるので、
// 「単位 1 語だけ書け」 と直接的に指示する。 分類ヒントは商品カテゴリ別に明示し、
// じゃがりこ / ポテチ / グミなど商品名そのものを few-shot に含めて固有名詞のドリフト
// (魚の「切れ」 を菓子に当てる等) を防ぐ。
const UNIT_SYSTEM_PROMPT =
  'あなたは食品の単位推定の専門家です。 食品名を受け取り、 「1 単位」 として最も自然な'
  + `日本語の単位を 1 つだけ答えます。 候補: ${ALLOWED_UNITS.join(' / ')}\n\n`
  + '分類ヒント:\n'
  + '- 菓子・スナック (じゃがりこ・ポテチ・ポテトチップス・チョコ・グミ・クッキー): 袋\n'
  + '- 飲料ペットボトル・水: 本\n'
  + '- 缶飲料 (ビール・缶コーヒー・コーラ缶): 缶\n'
  + '- 紙パック飲料 (牛乳・豆乳・ジュース): mL\n'
  + '- パン類 スライス (食パン・トースト): 枚\n'
  + '- パン類 単品 (菓子パン・コッペパン): 個\n'
  + '- 麺類 完成 (ラーメン・うどん): 杯\n'
  + '- 麺類 玉 (生うどん・焼きそば玉): 玉\n'
  + '- 生肉・生魚・粉物 (鶏むね・小麦粉・米): g\n'
  + '- 魚切り身: 切れ\n'
  + '- 卵・おにぎり・りんご・バナナ: 個\n'
  + '- 缶詰 (ホールトマト・ツナ・サバ): 缶\n'
  + '- 豆腐・納豆・もずく: パック\n\n'
  + '出力ルール (厳守): 単位 1 語のみを書く。 前置き「1 単位は」「答えは」 や説明文'
  + '・記号・「です」・改行は禁止。 候補リストの単語をそのまま 1 つだけ書く。\n\n'
  + '例:\n'
  + 'じゃがりこ → 袋\n'
  + 'ポテチ → 袋\n'
  + 'サラダチキン → 個\n'
  + 'ホールトマト → 缶\n'
  + '食パン → 枚\n'
  + 'コカコーラ 500ml → 本\n'
  + 'アサヒビール 350ml 缶 → 缶'

const buildUnitUserPrompt = (name) =>
  `${name.trim()} → `

// LLM 応答から単位を抽出。
//   1) <unit>X</unit> タグ最優先 (プロンプトで指示した形式)
//   2) 「1 単位は X」「答えは X」 「→ X」 のような自然文テンプレ
//   3) 候補リスト単語の応答内出現位置で末尾を採用 (フォールバック)
// 候補のうち、 日本語単位 (個・袋など) は前後の漢字だけ排除 (助詞「で」「は」 や
// 句読点はマッチを許す)、 ASCII 単位 (g・mL) は ASCII 英数字を排除する。
const isJapaneseUnit = (u) => /[぀-ヿ一-鿿]/.test(u)

const buildUnitBoundaryRe = (u) => {
  const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return isJapaneseUnit(u)
    ? new RegExp(`(^|[^\\u4e00-\\u9fff])${escaped}(?![\\u4e00-\\u9fff])`, 'gu')
    : new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'gu')
}

const parseUnit = (raw) => {
  const text = String(raw ?? '')
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (!stripped) return null
  if (/<think>/i.test(stripped) && !/<\/think>/i.test(stripped)) return null
  // 1) <unit>X</unit> タグ最優先
  const tag = stripped.match(/<unit>\s*([^<\s]+)\s*<\/unit>/i)
  if (tag) {
    const u = tag[1].trim()
    if (ALLOWED_UNITS.includes(u)) return u
  }
  // 2) 自然文テンプレ: 「1 単位は X」 「答えは X」 「→ X」
  //    LFM2.5-JP は「1 単位は 個です。」 のような形を返しがちなのでテンプレで先取り。
  const tmplPatterns = [
    /(?:1\s*単位は|答えは|単位は|→|->)\s*([^\s。、,.!?]+)/i,
  ]
  for (const re of tmplPatterns) {
    const m = stripped.match(re)
    if (m) {
      const candidate = m[1].trim()
      if (ALLOWED_UNITS.includes(candidate)) return candidate
    }
  }
  // 3) 末尾出現位置フォールバック
  let lastMatch = null
  let lastPos = -1
  ALLOWED_UNITS.forEach((u) => {
    const re = buildUnitBoundaryRe(u)
    let m
    let posForU = -1
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(stripped)) !== null) {
      posForU = m.index
    }
    if (posForU > lastPos) {
      lastPos = posForU
      lastMatch = u
    }
  })
  return lastMatch
}

export const estimateUnitForFood = async (llm, { name, modelLabel } = {}) => {
  if (!name?.trim()) return { ok: false, error: '食品名が空です' }
  if (!llm || !llm.isReady || llm.isGenerating) {
    return { ok: false, error: 'AI モデルがまだ準備中です' }
  }
  const messages = [
    { role: 'system', content: UNIT_SYSTEM_PROMPT },
    { role: 'user', content: buildUnitUserPrompt(name) },
  ]
  console.log('========== AI unit estimate ==========')
  console.log('[name]', name)
  console.log('[model]', modelLabel ?? '(unknown)')
  console.log('[messages]', JSON.stringify(messages, null, 2))
  try {
    const raw = await llm.generate(messages)
    console.log('[raw]', raw)
    const unit = parseUnit(raw)
    if (unit) {
      console.log('[result]', unit)
      console.log('======================================')
      return { ok: true, unit }
    }
    console.log('[result] rejected (no allowed unit found)')
    console.log('======================================')
    return {
      ok: false,
      error: `AI から有効な単位を取得できませんでした (応答: ${String(raw ?? '').slice(0, 40)}…)`,
    }
  } catch (err) {
    console.warn('[ai unit] generate failed:', err)
    console.log('======================================')
    return { ok: false, error: err?.message ?? String(err) }
  }
}

// 複数件をまとめて推定 (Chat FoodCard の「AI推定」用)。
//   items: [{ id, name, quantity, unit }, ...]
//   onItemDone: (item, result) => void — 1 件完了ごとのコールバック (UI 即時反映用)
// 戻り値: [{ id, ok, kcal?, error? }, ...]
export const estimateKcalBatch = async (llm, items, { modelLabel, onItemDone } = {}) => {
  const results = []
  for (const it of items) {
    const r = await estimateKcalForFood(llm, {
      name: it.name,
      quantity: it.quantity,
      unit: it.unit,
      modelLabel,
    })
    const entry = { id: it.id, ...r }
    results.push(entry)
    if (onItemDone) onItemDone(it, entry)
  }
  return results
}
