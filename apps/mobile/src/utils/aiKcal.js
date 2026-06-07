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
const parseKcal = (raw) => {
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
  // 3) 「N〜M」レンジ → 中央値 (1.7B がプロンプトのレンジをそのまま返す事例の救済)
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
export const estimateKcalForFood = async (llm, { name, quantity, unit, modelLabel } = {}) => {
  if (!name?.trim()) return { ok: false, error: '食品名が空です' }
  if (!unit?.trim()) return { ok: false, error: '単位が空です' }
  if (!llm || !llm.isReady || llm.isGenerating) {
    return { ok: false, error: 'AI モデルがまだ準備中です' }
  }
  const qty = Number.isFinite(quantity) && quantity > 0 ? quantity : 1
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(name, qty, unit) },
  ]
  const keyword = kcalFromKeyword(name)
  console.log('========== AI kcal estimate ==========')
  console.log('[name]', name)
  console.log('[model]', modelLabel ?? '(unknown)')
  console.log('[keyword]', keyword ? `${keyword.category} (${keyword.low}〜${keyword.high})` : '(none)')
  console.log('[messages]', JSON.stringify(messages, null, 2))
  try {
    const raw = await llm.generate(messages)
    console.log('[raw]', raw)
    const llmKcal = parseKcal(raw)

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
    onItemDone?.(it, entry)
  }
  return results
}
