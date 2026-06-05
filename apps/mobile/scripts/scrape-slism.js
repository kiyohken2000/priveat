/* eslint-disable no-console */
// カロリーSlism (https://calorie.slism.jp) スクレイパー。
//
// **個人利用専用** — public repo には scrape 結果を含めない (.gitignore 配下に出力)。
// Slism 規約: 引用要件 + 出典表記。個人利用 = 私的複製 (著 30 条) の範囲で利用。
//
// 戦略:
//   sitemap.xml → URL リスト → 各 URL の HTML を rate-limited で fetch → raw HTML 保存
//   parser (build-slism-foods.js) で raw HTML → foods_slism.json 化
//
// Usage:
//   node scripts/scrape-slism.js sitemap                # sitemap fetch + URL リスト保存
//   node scripts/scrape-slism.js fetch                  # 全 URL fetch (resumable)
//   node scripts/scrape-slism.js fetch --limit 10       # 最初の 10 件のみ (dry-run)
//   node scripts/scrape-slism.js status                 # 進捗確認
//
// 環境: Node 18+ (built-in fetch)

const path = require('path')
const fs = require('fs')

const SLISM_BASE = 'https://calorie.slism.jp'
const SITEMAP_URL = `${SLISM_BASE}/calorie-sitemap.xml`
const RATE_LIMIT_MS = 1500
const USER_AGENT = 'PriveatPersonalUseScraper/1.0 (personal use only, contact: votepurchase@gmail.com)'
const RETRY_DELAY_MS = 5000
const MAX_RETRIES = 2

const SCRIPT_DIR = __dirname
const DATA_DIR = path.join(SCRIPT_DIR, 'data')
const RAW_DIR = path.join(DATA_DIR, 'slism_raw')
const URL_LIST_PATH = path.join(DATA_DIR, 'slism_urls.json')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

// sitemap.xml から <loc> を全部拾い、/{6桁数字}/ パターンのみフィルタ。
const fetchSitemap = async () => {
  ensureDir(DATA_DIR)
  console.log(`[sitemap] fetching ${SITEMAP_URL}`)
  const res = await fetch(SITEMAP_URL, {
    headers: { 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`)
  const xml = await res.text()
  const matches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  console.log(`[sitemap] total <loc>: ${matches.length}`)
  const foodUrls = matches.filter((u) => /\/\d{6}\/?$/.test(u))
  console.log(`[sitemap] food URLs (/{6digit}/ pattern): ${foodUrls.length}`)
  const list = foodUrls.map((u) => {
    const m = u.match(/\/(\d{6})\/?$/)
    return { id: m[1], url: u }
  })
  fs.writeFileSync(URL_LIST_PATH, JSON.stringify(list, null, 2), 'utf-8')
  console.log(`[out] ${URL_LIST_PATH} (${list.length} entries)`)
}

const loadUrlList = () => {
  if (!fs.existsSync(URL_LIST_PATH)) {
    throw new Error(`URL list not found: ${URL_LIST_PATH}\nRun: node scripts/scrape-slism.js sitemap`)
  }
  return JSON.parse(fs.readFileSync(URL_LIST_PATH, 'utf-8'))
}

const fetchOne = async (url, attempt = 1) => {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    })
    if (res.status === 404) return { status: 404, body: null }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.text()
    return { status: 200, body }
  } catch (e) {
    if (attempt > MAX_RETRIES) throw e
    console.log(`  [retry ${attempt}/${MAX_RETRIES}] ${url}: ${e.message}`)
    await sleep(RETRY_DELAY_MS)
    return fetchOne(url, attempt + 1)
  }
}

const fetchAll = async ({ limit } = {}) => {
  ensureDir(RAW_DIR)
  const list = loadUrlList()
  const target = limit ? list.slice(0, limit) : list
  console.log(`[fetch] ${target.length} URLs, rate ${RATE_LIMIT_MS}ms/req`)
  let done = 0
  let skipped = 0
  let failed = 0
  const startedAt = Date.now()
  for (const entry of target) {
    const outPath = path.join(RAW_DIR, `${entry.id}.html`)
    if (fs.existsSync(outPath)) {
      skipped += 1
      done += 1
      continue
    }
    try {
      const { status, body } = await fetchOne(entry.url)
      if (status === 404) {
        fs.writeFileSync(outPath + '.404', '', 'utf-8')
        console.log(`  [404] ${entry.id}`)
      } else {
        fs.writeFileSync(outPath, body, 'utf-8')
      }
      done += 1
      if (done % 50 === 0 || done === target.length) {
        const elapsed = (Date.now() - startedAt) / 1000
        const remaining = target.length - done
        const eta = remaining * (elapsed / Math.max(done - skipped, 1))
        console.log(
          `  [progress] ${done}/${target.length} (skip ${skipped}, fail ${failed}) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s`,
        )
      }
    } catch (e) {
      failed += 1
      console.log(`  [FAIL] ${entry.id}: ${e.message}`)
    }
    await sleep(RATE_LIMIT_MS)
  }
  console.log(`[fetch] done. total ${done}/${target.length}, skip ${skipped}, fail ${failed}`)
}

const status = () => {
  if (!fs.existsSync(URL_LIST_PATH)) {
    console.log('URL list not yet created. Run: node scripts/scrape-slism.js sitemap')
    return
  }
  const list = loadUrlList()
  ensureDir(RAW_DIR)
  const files = fs.readdirSync(RAW_DIR)
  const ok = files.filter((f) => f.endsWith('.html')).length
  const notFound = files.filter((f) => f.endsWith('.404')).length
  console.log(`URL list:    ${list.length}`)
  console.log(`Fetched OK:  ${ok}`)
  console.log(`404:         ${notFound}`)
  console.log(`Remaining:   ${list.length - ok - notFound}`)
}

const main = async () => {
  const cmd = process.argv[2]
  const args = process.argv.slice(3)
  const limitArg = args.indexOf('--limit')
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : null
  switch (cmd) {
    case 'sitemap':
      await fetchSitemap()
      break
    case 'fetch':
      await fetchAll({ limit })
      break
    case 'status':
      status()
      break
    default:
      console.log('Usage:')
      console.log('  node scripts/scrape-slism.js sitemap')
      console.log('  node scripts/scrape-slism.js fetch [--limit N]')
      console.log('  node scripts/scrape-slism.js status')
      process.exit(1)
  }
}

main().catch((e) => {
  console.error('ERROR:', e)
  process.exit(1)
})
