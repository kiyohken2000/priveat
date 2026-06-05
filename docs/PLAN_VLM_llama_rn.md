# 実装計画 — VLM (llama.rn 切替版)

> Phase 9 の改訂版。executorch 前提の旧計画は [PLAN_VLM_料理写真認識.md](./PLAN_VLM_料理写真認識.md) に残してある。
>
> 本文書は **executorch v0.9.0 の LFM2.5-VL-450M が iOS で `Failed to generate multimodal response` を返す現象に対し、llama.rn (llama.cpp バインディング) の `initMultimodal` 経路へ切り替える計画**。
>
> ★ マークは「ユーザーと事前合意したい設計判断」。合意してからコードに進む。

## 1. 経緯 (なぜ executorch をやめるか)

executorch v0.9.0 + `LFM2_5_VL_450M_QUANTIZED` で実機 iOS 検証中、以下が判明:

| 試した対策 | 結果 |
|---|---|
| `sendMessage(text, { imagePath })` (公式 docs) | `Cannot call ... UndefinedValue` |
| parser → vision swap タイミング修正 (3 段階待ち) | エラー変化 → `Failed to generate multimodal response` |
| `file://` プレフィックス揺れ修正 | 変化なし (内部で normalize されてる) |
| systemPrompt 除去 / 英語短文プロンプト | 変化なし |
| `expo-image-manipulator` で 1024px リサイズ | 変化なし (v0.9.0 は内部 letterboxing する) |
| iOS deployment target = 17.0 | 既に正しく設定済み |

`runner_->generate(inputs, ...)` が native 内部で Error を返している (`common/rnexecutorch/models/llm/LLM.cpp:149`)。詳細エラーが JS に伝播してこないため、Xcode console を見ない限り原因確定不可。

GitHub Issue 検索でも同じ症状の事例は未掲載。450M 量子化版固有のバグの可能性が高いが、上流の修正待ちは見通し不明。

→ **llama.rn (= llama.cpp の React Native バインディング) の `initMultimodal` 機能で代替する**。llama.cpp の mtmd は実績豊富で、SmolVLM / Qwen2-VL / LLaVA など多数の GGUF VLM をサポート。

## 2. アーキテクチャ全体像

### 2 エンジン同居方式 (排他制御)

[参考: votepurchase「2エンジン同居問題：Metal Working Set との戦い」](https://qiita.com/votepurchase/items/0f24d056b5c252699a79)

- 既存 parser / coach は **executorch のまま** (動作実績あり、変更不要)
- vision (写真認識) **だけ llama.rn** に置換
- iPhone の Metal Working Set 制約 (例: iPhone 13 mini で 2863MB) があるため **両エンジンを並行ロードしない**
- 写真認識を始めるとき:
  1. executorch をアンロード
  2. GPU メモリ解放を ~400ms 待つ
  3. llama.rn 初期化 + `initMultimodal`
  4. 推論
  5. llama.rn 解放
  6. executorch (parser or coach) を再ロード

### モデル swap 状態遷移

```
[起動]
  └ parser (executorch) ロード

[mode='log' のとき]
  └ parser (executorch) 常駐

[mode='coach' のとき]
  └ coach (executorch) 常駐

[料理写真認識ボタン押下時]
  ├ 直前のロール (log/coach) を覚える
  ├ executorch をアンロード
  ├ 400ms 待機 (GPU メモリ解放)
  ├ llama.rn 初期化 + initMultimodal(mmproj)
  ├ completion / sendMessage で画像 + プロンプトを推論
  ├ 応答受信
  ├ llama.rn 解放
  ├ executorch (直前ロール) 再ロード
  └ FoodCard 表示
```

## 3. モデル選定 ★

llama.cpp 互換の GGUF VLM 候補 (Hugging Face で HEAD 検証済み実サイズ):

| モデル | パラメータ | 量子化 | main + mmproj 実サイズ | 想定 RAM | 日本語 | 備考 |
|---|---|---|---|---|---|---|
| **SmolVLM-500M-Instruct** | 500M | main Q8 + mmproj Q8 | **~521 MB** (417 + 104) | ~1.5GB | △ | 軽量。`ggml-org/SmolVLM-500M-Instruct-GGUF` |
| **Qwen3-VL-2B-Instruct** | 2B | main Q4_K_M + mmproj Q8 | **~1.49 GB** (1.06 + 0.42) | ~3GB | ○ | 公式 `Qwen/Qwen3-VL-2B-Instruct-GGUF`、Apache 2.0、Qwen2 の後継 |
| (参考) Qwen2-VL-2B | 2B | Q4 + Q8 mmproj | ~1.5GB | ~3GB | ○ | bartowski quant、Qwen3 で更新済 |
| (参考) MiniCPM-V-2.6 | 8B | Q4 + mmproj | ~5GB+ | ~7GB | ◎ | iPhone 一般機種で OOM リスク高 |

### ✅ 決定 A: 主軸モデル — **両方サポート** (実証結果反映済)

ModelScreen の「写真」タブで以下 2 つを選択式にする:
- **Qwen3-VL-2B-Instruct (main Q4_K_M + mmproj Q8)** — **推奨・実用ライン**。日本語料理名を 1-2 単語で正確に返す (実機確認: 餃子の写真 → `餃子` のみ)。RAM 6GB+ 推奨。`Qwen/Qwen3-VL-2B-Instruct-GGUF` (公式、Apache 2.0)
- **SmolVLM-500M-Instruct (main Q8 + mmproj Q8)** — **軽量・不安定**。`ggml-org/SmolVLM-500M-Instruct-GGUF` (公式、Apache 2.0)。実機確認では `jinja=true` + temperature 0.1 でも日本語システムプロンプトが効かず、英語の説明文 5 行が返ってしまう。低スペック端末 (RAM 4GB) でのフォールバック用にとどめ、実用ユースは Qwen3-VL-2B を推奨

`getRecommendation` の vision ロールは tier に応じて (low: SmolVLM-500M, mid/high: Qwen3-VL-2B 推奨) のロジックを入れる。

#### モデルファイル一覧 (HEAD 検証済 2026-06)

```
SmolVLM-500M:
  main:   https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/SmolVLM-500M-Instruct-Q8_0.gguf       (~417 MB)
  mmproj: https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF/resolve/main/mmproj-SmolVLM-500M-Instruct-Q8_0.gguf (~104 MB)

Qwen3-VL-2B:
  main:   https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf     (~1.06 GB)
  mmproj: https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf (~425 MB)
```

### ✅ 決定 B: 既存 executorch VLM モデル (450M / 1.6B) は **削除**

`llmModels.js` の `kind: 'vision'` エントリ (LFM2.5-VL-450M, LFM2.5-VL-1.6B) を削除。`llmModelsVlm.js` (新設) に llama.rn 用 2 モデルを置き、ModelScreen は kind に応じて executorch / llama.rn を判別。

## 4. パッケージ追加

```json
{
  "dependencies": {
    "llama.rn": "^0.12.4"
  }
}
```

- llama.rn は `useNewArchEnabled` 必須 (このプロジェクトは既に新アーキ有効、OK)
- iOS で Metal を使う (`use_gpu: true`)
- **Expo dev client の再ビルドが必須** (native module 追加のため)

### モデルファイル DL

executorch の `ResourceFetcher` は使えない (executorch 専用)。GGUF ファイル + mmproj GGUF を別経路で取得する必要がある:

- **DL 元**: Hugging Face の各モデルリポジトリ (例: `Qwen/Qwen2-VL-2B-Instruct-GGUF` 等)
- **DL 先**: `FileSystem.cacheDirectory` 配下 (expo-file-system)
- **進捗表示**: `expo-file-system` の `downloadResumable` で `onProgress` callback
- **URL 管理**: 新規 `data/llmModelsVlm.js` を作成 (GGUF + mmproj の 2 ファイル URL ペア)

### ✅ 決定 C: モデル DL タイミング — **設定でトグル ON した時**

ModelScreen の「写真」タブに「写真認識を有効にする」トグルを置く。OFF 状態:
- 写真認識ボタンは押せる (ActionSheet は表示)
- ただし押すと「設定 > LLM モデル > 写真 で有効化してください」アラート

ON にした瞬間に DL 開始 (Qwen2-VL-2B Q4 で ~1.5GB)、進捗表示を出す。DL 完了後、写真認識ボタンが本格動作。

## 5. 既存コードへの影響

### `state/modelContext.js`

現状: `parserModel` / `coachModel` / `visionModel` の 3 ロール、すべて executorch の `useLLM` 経由。

変更:
- `visionModel` は executorch ではなく llama.rn の context を指す
- `useActiveLLM()` は parser/coach 用 (executorch) のまま
- `useActiveVlm()` を新規追加 → llama.rn の context wrapper
- mode 'log'/'coach' のとき executorch のみ ready、vision call 中だけ llama.rn ready

### 排他制御 orchestrator (新規)

`state/vlmOrchestrator.js` を新規追加:
```js
// 擬似コード
async function runWithLlamaRn(callback) {
  const previousRole = currentRole
  setPreventLoad(true)           // executorch useLLM の preventLoad を立てて unload
  await waitFor(400)              // Metal Working Set 解放待ち
  const llama = await initLlama({ model: vlmGgufPath, n_ctx: 4096 })
  await llama.initMultimodal({ path: mmprojPath, use_gpu: true })
  try {
    const result = await callback(llama)
    return result
  } finally {
    await llama.release()
    await waitFor(400)
    setPreventLoad(false)         // executorch 再ロード
    setCurrentRole(previousRole)
  }
}
```

### `useLLM` の `preventLoad` 活用

executorch v0.9.0 の `useLLM` には `preventLoad: boolean` パラメータがある (`hooks/natural_language_processing/useLLM.js:14-17`)。これを立てると model load を skip。`controllerInstance.delete()` も `useEffect` cleanup で呼ばれる。

→ Provider 側で `preventLoad` を state にし、orchestrator から true/false 切替できるようにする。これで「llama.rn 使用中は executorch を退避」が綺麗に実装できる。

### `scenes/chat/Chat.js`

- 既存 `handlePhotoForVision` を **完全に書き換え**:
  - downloadModel / setCurrentRole('vision') / sendMessage 系を削除
  - `runWithLlamaRn(async (llama) => { ... })` で囲む
  - llama.rn の completion API で画像 + プロンプトを渡す
- `activeModelRef` / 3 段階待ち polling は不要に (executorch swap しないので)

### `scenes/settings/ModelScreen.js`

- 写真タブの選択肢を llama.rn 用 (Qwen2-VL-2B / SmolVLM-500M etc.) に置換
- DL 状態表示 / 削除ボタンを GGUF ファイル対応に

## 6. プロンプト・呼び出し例

llama.rn の completion API (実装時に最終確認):
```js
const result = await llama.completion({
  messages: [
    { role: 'system', content: VLM_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `file://${imagePath}` } },
        { type: 'text', text: 'この写真の料理名を答えてください。' },
      ],
    },
  ],
  n_predict: 128,
  temperature: 0.2,
})
```

応答テキストは旧 PLAN §6 と同じ「カンマ区切り料理名」を期待。

## 7. 実装ステップ (コミット粒度)

| # | 内容 | 想定変更ファイル |
|---|---|---|
| 1 | **llama.rn 導入 + Expo dev client 再ビルド** | `package.json`, prebuild |
| 2 | **VLM モデル定義 + DL サービス** | `data/llmModelsVlm.js` (新規), `services/vlmModelStorage.js` (新規) |
| 3 | **設定画面に VLM ON/OFF トグル + DL ボタン** | `scenes/settings/ModelScreen.js` |
| 4 | **executorch `useLLM` に `preventLoad` 配線** | `state/modelContext.js` |
| 5 | **vlmOrchestrator + 排他制御** | `state/vlmOrchestrator.js` (新規) |
| 6 | **Chat の handlePhotoForVision を llama.rn 経路に置換** | `scenes/chat/Chat.js` |
| 7 | **応答 → FoodCard 表示 (旧 ④ と同じ)** | `scenes/chat/Chat.js`, `scenes/chat/FoodCard.js` (料理名編集追加) |
| 8 | **food_log source='vision' 追加** | `db/foodLog.js` |
| 9 | **旧 executorch VLM モデル削除** | `data/llmModels.js`, 関連 import |

実装は 1→9 順。1-2 で土台、3-5 で排他制御の枠、6 で疎通、7-8 で本実装、9 で掃除。各ステップ実機確認してコミット。

## 8. リスク・未確認事項

- ❓ **llama.rn の Expo SDK 56 / RN 0.85 互換性**: README で confirmed か要確認。最近の RN メジャーには追随済みだが新アーキの細部で詰まる可能性
- ❓ **iPhone 実機での Qwen2-VL-2B 推論速度**: A15/A16/A17 で 1 画像あたり何秒かは未知 (10秒以内なら実用)
- ❓ **Metal Working Set 制約の実測**: 「executorch unload → 400ms → llama.rn init」で本当に解放されるか、もっと長く必要か
- ❓ **mmproj DL URL の安定性**: Hugging Face mirror が変わると DL 経路が壊れる
- ❓ **executorch unload→reload のステート保持**: messageHistory / chatConfig が消える前提で再構築するロジックが必要
- ❓ **llama.rn のメモリリーク**: release() 後本当に Metal heap が解放されるか

## 9. 旧計画との差分

| 項目 | 旧 (executorch) | 新 (llama.rn) |
|---|---|---|
| 推論エンジン | executorch (LFM2.5-VL) | llama.rn (Qwen2-VL or SmolVLM) |
| モデル DL | executorch ResourceFetcher | 自前 (expo-file-system) |
| 排他制御 | parser/coach/vision 同じ useLLM の swap | 2 エンジン同居 + preventLoad |
| API | `useLLM().sendMessage(text, { imagePath })` | `initLlama` + `initMultimodal` + `completion` |
| Expo dev client 再ビルド | 不要 (既にビルド済) | **必要** |
| 工数感 | 軽 (動けば) | 中〜大 |

旧計画 §3 (UI 案A/B/C) と §4 (案 I/II)、§5 (撮影フロー), §6 (プロンプト), §8 (検証) はそのまま流用可能。

## 10. 参考

- [llama.rn (GitHub)](https://github.com/mybigday/llama.rn) — README にマルチモーダル例あり
- [llama.cpp mtmd ドキュメント](https://github.com/ggerganov/llama.cpp/tree/master/tools/mtmd) — mmproj 仕組み
- [Qwen2-VL-2B-Instruct GGUF (HuggingFace)](https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct) — モデルカード (GGUF 変換は community fork が多い)
- [SmolVLM-Instruct GGUF](https://huggingface.co/HuggingFaceTB/SmolVLM-Instruct) — モデルカード
- [votepurchase: ExecuTorch と llama.rn を 1 アプリで共存させる](https://qiita.com/votepurchase/items/0f24d056b5c252699a79) — 2 エンジン同居の原典
