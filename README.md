# Priveat（プライベート）

スマホ単体（オンデバイス）で動くローカルAIを使った、プライバシー重視・オフライン対応・運用コストほぼゼロの食事／体重管理アプリ。

`private`（端末内で完結する＝プライベート）＋ `eat`（食べる）の造語。最大の強みである「食事記録が端末の外に出ない」を名前で表現しています。

## 設計原則

**「LLM＝言葉とコーチング、数字＝OCRと食品DB」**

- LLM / VLM は入力（テキスト・写真）の意味理解と、アドバイス・履歴への質問応答だけを担う
- カロリー・栄養素・体重などの数値は、OCR（文字の直接読み取り）と食品DB（公式成分表）から得る
- LLMには数値を発明させない

## 技術スタック

- **フレームワーク**: React Native + Expo（iOS / Android）, New Architecture 有効
- **ローカルLLM（主）**: react-native-executorch（.pte形式。テキスト構造化・コーチング・VLM）
- **ローカルLLM（予備）**: llama.rn（GGUF。GBNF文法フォールバック用）
- **OCR**: rn-mlkit-ocr（ML Kit, ラベル・スクショ用）
- **チャットUI**: react-native-gifted-chat
- **ローカルDB**: expo-sqlite（食品成分表・ログ）
- **ヘルス連携**: react-native-health-link（HealthKit / Health Connect）
- **食品データ**: 文部科学省 日本食品標準成分表（八訂）増補2023年

ビルド前提: dev client（**Expo Go は使えません**）。

## リポジトリ構成

```
priveat/
├── apps/
│   ├── mobile/   # React Native アプリ本体
│   └── web/      # 予約（未着手）
└── docs/
    ├── PROPOSAL_企画書.md       # なぜ作るか
    ├── SPEC_アプリ仕様書.md     # 技術仕様（単一の真実）
    └── PROGRESS_進捗表.md       # フェーズ別チェックリスト
```

## はじめに

### 必要なもの

- Node.js / Yarn
- Expo CLI
- EAS CLI（dev client ビルド用）
- iOS の場合: Xcode / Apple Developer アカウント
- Android の場合: Android Studio

### セットアップ

```bash
cd apps/mobile
yarn install
```

### Dev client ビルド

```bash
# iOS
eas build --profile development --platform ios

# Android
eas build --profile development --platform android
```

詳細なコマンドは [apps/mobile/commands.txt](apps/mobile/commands.txt) を参照。

### 起動

```bash
cd apps/mobile
yarn start
```

ビルド済みの dev client を実機にインストールしてから Metro に接続します。

## ドキュメント

- [企画書](docs/PROPOSAL_企画書.md) — 背景・目的・スコープ
- [仕様書](docs/SPEC_アプリ仕様書.md) — 技術仕様・アーキテクチャ・データモデル
- [進捗表](docs/PROGRESS_進捗表.md) — フェーズ別の作業チェックリスト

## ライセンス・出典

- 食品成分データ: 「日本食品標準成分表（八訂）増補2023年から引用」
- 各OSSライセンスは [LICENSE](LICENSE) および各依存パッケージのライセンスに従う
