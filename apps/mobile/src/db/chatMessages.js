import { getDb } from './index'

// chat_messages テーブルへの coach Q&A 永続化。
//   - 記録モードのチャット (food_log 抽出) や OCR は永続化しない
//     (成果物が別テーブルに保存されているため)
//   - 1 つの Q&A は user 行 + assistant 行の 2 行で保存。created_at で順序を担保。
//   - payload は JSON で modelId / pairId などを格納。
//   - 日付フィルタ (date(created_at,'localtime') = ?) で日詳細から引き出す。

const makeId = (role, ts) => `coach-${ts}-${role}-${Math.random().toString(36).slice(2, 6)}`

export const insertCoachExchange = async ({ userText, assistantText, modelId }) => {
  if (!userText || !assistantText) return
  const db = getDb()
  const now = Date.now()
  const userCreated = new Date(now).toISOString()
  // assistant の created_at は user より 1ms 後ろにして表示順を保証
  const assistantCreated = new Date(now + 1).toISOString()
  const pairId = `pair-${now}`
  const payload = JSON.stringify({ modelId: modelId ?? null, pairId })
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO chat_messages (id, created_at, role, text, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [makeId('user', now), userCreated, 'user', userText, payload],
    )
    await db.runAsync(
      `INSERT INTO chat_messages (id, created_at, role, text, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [makeId('assistant', now), assistantCreated, 'assistant', assistantText, payload],
    )
  })
}

// 該当日の coach Q&A を時刻昇順で返す。
//   戻り値: [{ id, created_at, role, text, modelId }]
export const getCoachChatByDate = async (date) => {
  const db = getDb()
  const rows = await db.getAllAsync(
    `SELECT id, created_at, role, text, payload
       FROM chat_messages
      WHERE date(created_at, 'localtime') = ?
      ORDER BY created_at ASC`,
    [date],
  )
  return (rows ?? []).map((r) => {
    let modelId = null
    if (r.payload) {
      try {
        const p = JSON.parse(r.payload)
        modelId = p?.modelId ?? null
      } catch (e) {
        // payload が壊れていても無視
      }
    }
    return {
      id: r.id,
      created_at: r.created_at,
      role: r.role,
      text: r.text,
      modelId,
    }
  })
}

export const deleteChatMessage = async (id) => {
  const db = getDb()
  await db.runAsync(`DELETE FROM chat_messages WHERE id = ?`, [id])
}
