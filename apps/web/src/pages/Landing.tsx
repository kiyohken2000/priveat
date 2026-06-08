import { createContext, useContext, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import s from './Landing.module.css'

type Shot = { src: string; alt: string; caption?: string }

type Feature = {
  label: string
  title: string
  lead: string
  bullets: string[]
  shots: Shot[]
}

const features: Feature[] = [
  {
    label: '記録モード',
    title: '思いついたまま書くだけ',
    lead:
      'テキスト・写真・ラベル・レシート・ヘルスケアのスクショまで、 端末内 LLM が自動で食事・体重・運動に分解してカード化します。',
    bullets: [
      'テキスト一文で食事 / 体重 / 運動を同時に記録',
      '料理写真からカロリーと PFC を推定',
      '商品ラベルやレシートを OCR して栄養情報に変換',
      '体重計・フィットネスアプリのスクショからも取り込み',
    ],
    shots: [
      { src: '/screenshots/record-home.png', alt: '記録モードの入口', caption: 'チャットから記録を開始' },
      { src: '/screenshots/record-text.png', alt: 'テキスト入力', caption: 'テキスト一文で分解' },
      { src: '/screenshots/record-photo.png', alt: '料理写真認識', caption: '料理写真から推定' },
      { src: '/screenshots/record-label.png', alt: '商品ラベル認識', caption: '商品ラベルを OCR' },
      { src: '/screenshots/record-receipt.png', alt: 'レシート認識', caption: 'レシートをまとめて取込' },
      { src: '/screenshots/record-scale.png', alt: '体重計スクショ認識', caption: '体重計のスクショ' },
      { src: '/screenshots/record-fitness.png', alt: 'フィットネススクショ認識', caption: 'フィットネスアプリの記録' },
    ],
  },
  {
    label: '今日のサマリー',
    title: '今日の状況を 1 画面で',
    lead: '摂取・消費・差分、 栄養バランス、 そしてマスコットからの AI アドバイスをワンビューで。',
    bullets: [
      '摂取 / 消費 / 差分カロリーを即座に把握',
      'PFC 栄養バランスをグラフで可視化',
      'マスコットが今日を講評してくれる',
    ],
    shots: [
      { src: '/screenshots/summary-1.png', alt: '今日のサマリー', caption: '今日の数値とアドバイス' },
      { src: '/screenshots/summary-2.png', alt: '今日のサマリー 内訳', caption: '食事の内訳' },
      { src: '/screenshots/summary-3.png', alt: '今日のサマリー 続き', caption: '一日の流れ' },
    ],
  },
  {
    label: 'コーチモード',
    title: 'あなた専用の食事コーチ',
    lead: 'その日の摂取・消費・体重を踏まえて、 端末内 LLM が傾向と次の一手を返します。 雑談もできます。',
    bullets: [
      '「今日どうだった？」で即講評',
      '実データに基づく具体的な提案',
    ],
    shots: [
      { src: '/screenshots/coach-1.png', alt: 'コーチモード 入口' },
      { src: '/screenshots/coach-2.png', alt: 'コーチとの会話例' },
    ],
  },
  {
    label: '履歴',
    title: 'グラフで体重とカロリー収支を一望',
    lead: '体重推移とカロリー収支を可視化。 週次の AI アドバイスで停滞期も方向を見失いません。',
    bullets: [
      '体重推移は最大 30 日',
      'カロリー収支は 7 日分の棒グラフ',
      'カレンダーから過去の記録に飛べる',
    ],
    shots: [
      { src: '/screenshots/history-1.png', alt: '履歴 グラフ', caption: 'グラフで体重とカロリー' },
      { src: '/screenshots/history-2.png', alt: '履歴 週次アドバイス', caption: '週次の AI アドバイス' },
      { src: '/screenshots/history-3.png', alt: '履歴 カレンダー', caption: 'カレンダーから日別へ' },
    ],
  },
  {
    label: 'レシピ',
    title: 'まとめ作りを 1 食分に分割',
    lead:
      '材料リストと食数を投げると、 1 食あたりのカロリーを算出してマスタ化。 「カレー 1 食」のように呼び出せます。',
    bullets: [
      '材料リスト → 1 食あたり kcal を自動算出',
      '食事ログから名前で呼び出して再記録',
      '材料・食数・栄養はあとから編集可能',
    ],
    shots: [
      { src: '/screenshots/recipe-register-1.png', alt: 'レシピ登録', caption: '材料と食数を入力' },
      { src: '/screenshots/recipe-register-2.png', alt: 'レシピ登録 結果', caption: '1 食あたりに換算' },
      { src: '/screenshots/recipe-edit.png', alt: 'レシピ編集', caption: '保存後も編集可能' },
    ],
  },
  {
    label: 'マイ食品',
    title: '自分の定番食品をマスタ化',
    lead:
      'ラベル OCR や手入力で登録した食品は自動でマスタに保存。 名前を呼ぶだけで再記録できます。',
    bullets: [
      'ラベル OCR から自動でマスタ追加',
      '手入力でも追加 / 編集可能',
      '一覧から再記録 & 絞り込み検索',
    ],
    shots: [
      { src: '/screenshots/my-foods-1.png', alt: 'マイ食品 一覧' },
      { src: '/screenshots/my-foods-2.png', alt: 'マイ食品 詳細' },
    ],
  },
  {
    label: '設定',
    title: '細かな挙動を自分好みに',
    lead:
      'コーチ AI の話し方、 目標値、 通知タイミングなど、 アプリの挙動を自分用にカスタマイズできます。',
    bullets: [
      'コーチへの指示文を編集してキャラを調整',
      '目標値・表示・同期の挙動を設定',
    ],
    shots: [
      { src: '/screenshots/settings-1.png', alt: '設定 一覧' },
      { src: '/screenshots/settings-coach.png', alt: 'コーチへの指示文' },
    ],
  },
  {
    label: 'プライバシー / LLM',
    title: 'モデルもデータも、 端末内で完結',
    lead:
      'クラウドに記録を送らず、 LLM もすべて端末上で動きます。 用途ごとに使うモデルを選べます。',
    bullets: [
      'Qwen3 / Gemma 3 / LFM 2.5 などから選択',
      '記録用・コーチ用・写真認識を別々に最適化',
      'ベンチで速度・精度を見比べて選べる',
    ],
    shots: [
      { src: '/screenshots/model-select.png', alt: 'LLM モデル選択' },
      { src: '/screenshots/model-compare.png', alt: 'LLM モデル比較' },
    ],
  },
  {
    label: 'ヘルス連携',
    title: 'OS のヘルスケアと連携',
    lead:
      '体重・歩数・消費カロリーを OS のヘルスケアと連動。 Apple Watch などのウェアラブルも活用できます。',
    bullets: [
      '体重・歩数・消費カロリーを取り込み',
      'iOS は HealthKit、 Android は Health Connect',
    ],
    shots: [{ src: '/screenshots/health-sync.png', alt: 'ヘルスケアと連携' }],
  },
]

const ZoomContext = createContext<(src: string, alt: string) => void>(() => {})

function Phone({
  src,
  alt,
  extra,
  eager,
}: {
  src: string
  alt: string
  extra?: string
  eager?: boolean
}) {
  const onZoom = useContext(ZoomContext)
  return (
    <button
      type="button"
      className={`${s.phone} ${extra ?? ''}`}
      onClick={() => onZoom(src, alt)}
      aria-label={`${alt} を拡大表示`}
    >
      <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </button>
  )
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  return (
    <div
      className={s.lightbox}
      onClick={onClose}
      role="button"
      tabIndex={0}
      aria-label="拡大表示を閉じる"
    >
      <img src={src} alt={alt} />
    </div>
  )
}

function FeatureBody({ f }: { f: Feature }) {
  return (
    <div>
      <p className={s.featureLabel}>{f.label}</p>
      <h2 className={s.featureTitle}>{f.title}</h2>
      <p className={s.featureLead}>{f.lead}</p>
      <ul className={s.featureBullets}>
        {f.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  )
}

function PhonePair({ shots, reverse }: { shots: Shot[]; reverse: boolean }) {
  return (
    <div className={s.phonePair}>
      {shots.map((shot, i) => {
        const tilted = (i === 0) === !reverse ? '' : s.phoneAlt
        return (
          <Phone key={shot.src} src={shot.src} alt={shot.alt} extra={`${s.phoneMd} ${tilted}`} />
        )
      })}
    </div>
  )
}

function FeatureAlternating({ f, index }: { f: Feature; index: number }) {
  const reverse = index % 2 === 1
  const altBg = index % 2 === 1
  return (
    <div
      className={[
        s.featureSection,
        reverse ? s.reverse : '',
        altBg ? s.featureSectionAlt : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={s.featureBody}>
        <FeatureBody f={f} />
      </div>
      <div className={s.featureShot}>
        {f.shots.length === 1 ? (
          <Phone src={f.shots[0].src} alt={f.shots[0].alt} extra={reverse ? s.phoneAlt : ''} />
        ) : (
          <PhonePair shots={f.shots} reverse={reverse} />
        )}
      </div>
    </div>
  )
}

function FeatureGallery({ f, altBg }: { f: Feature; altBg: boolean }) {
  return (
    <div className={`${s.gallerySection} ${altBg ? s.altBg : ''}`}>
      <div className={s.galleryHeader}>
        <FeatureBody f={f} />
      </div>
      <div className={s.galleryGrid}>
        {f.shots.map((shot) => (
          <div key={shot.src} className={s.galleryItem}>
            <Phone src={shot.src} alt={shot.alt} extra={s.phoneSm} />
            {shot.caption ? <span className={s.galleryCaption}>{shot.caption}</span> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Landing() {
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)
  let altIndex = 0
  return (
    <ZoomContext.Provider value={(src, alt) => setZoom({ src, alt })}>
      {/* Hero */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div>
            <span className={s.eyebrow}>PRIVATE FOOD &amp; HEALTH TRACKER</span>
            <h1 className={s.heroTitle}>
              プライベートな
              <br />
              食事ログ、AI と一緒に。
            </h1>
            <p className={s.heroLead}>
              テキスト・写真・ラベルから自動で食事を記録。
              <br />
              LLM もデータも、 ぜんぶ端末内で完結します。
            </p>
            <ul className={s.heroPills}>
              <li>📱 端末内で完結</li>
              <li>🤖 オンデバイス LLM</li>
              <li>🆓 無料・広告なし</li>
            </ul>
          </div>
          <div className={s.heroShotWrap}>
            <Phone src="/screenshots/summary-1.png" alt="今日のサマリー画面" eager />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className={s.trust}>
        <div className={s.trustInner}>
          <div className={s.trustItem}>
            <span className={s.trustIcon}>🔒</span>
            <span className={s.trustTitle}>記録はすべて端末内</span>
            <span className={s.trustDesc}>サーバには何も送りません</span>
          </div>
          <div className={s.trustItem}>
            <span className={s.trustIcon}>⚡</span>
            <span className={s.trustTitle}>オフラインで動く</span>
            <span className={s.trustDesc}>LLM も端末上で実行</span>
          </div>
          <div className={s.trustItem}>
            <span className={s.trustIcon}>🚫</span>
            <span className={s.trustTitle}>広告・解析ゼロ</span>
            <span className={s.trustDesc}>第三者 SDK は組み込まず</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className={s.features}>
        {features.map((f) => {
          if (f.shots.length >= 3) {
            const altBg = altIndex++ % 2 === 1
            return <FeatureGallery key={f.title} f={f} altBg={altBg} />
          }
          return <FeatureAlternating key={f.title} f={f} index={altIndex++} />
        })}
      </section>

      {/* Closing */}
      <section className={s.closing}>
        <div className={s.closingInner}>
          <h2 className={s.closingTitle}>もうすぐリリース予定</h2>
          <p className={s.closingLead}>
            日本のストアでの配信を準備中です。 詳細はこのページで告知します。
          </p>
          <p className={s.closingMeta}>※ 配信地域は日本のみを予定しています。</p>
          <div className={s.closingLinks}>
            <Link to="/privacy">プライバシーポリシー</Link>
            <Link to="/terms">利用規約</Link>
            <a href="mailto:retwpay@gmail.com">サポート</a>
          </div>
        </div>
      </section>

      {zoom && <Lightbox src={zoom.src} alt={zoom.alt} onClose={() => setZoom(null)} />}
    </ZoomContext.Provider>
  )
}
