// react-native-health-connect 3.5.x の Expo 統合補完プラグイン。
// 同梱の app.plugin.js は Android 13 以下用の intent-filter しか追加しない上、
// HealthConnectPermissionDelegate.setPermissionDelegate(this) を MainActivity に注入しないため、
// CNG プロジェクトでは以下 3 つが欠ける:
//  (a) MainActivity.onCreate で setPermissionDelegate(this) → requestPermission lateinit 未初期化クラッシュ
//  (b) <activity-alias ViewPermissionUsageActivity> → Android 14+ で Health Connect 設定画面にアプリが出ない
//  (c) <queries><package="com.google.android.apps.healthdata"> → Android 11+ package visibility 制約で
//      Health Connect APK (Android 13 以下) が解決できず getSdkStatus が 1 (未インストール扱い) を返す
// このプラグインで全部やる。
const { withMainActivity, withAndroidManifest, AndroidConfig } = require('@expo/config-plugins')

const IMPORT_LINE =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate'
const SETUP_LINE = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)'
const HC_PROVIDER_PACKAGE = 'com.google.android.apps.healthdata'

const addImportKotlin = (contents) => {
  if (contents.includes(IMPORT_LINE)) return contents
  return contents.replace(/^(package [^\n]+\n)/m, `$1\n${IMPORT_LINE}\n`)
}

const insertSetupCallKotlin = (contents) => {
  if (contents.includes(SETUP_LINE)) return contents

  const superOnCreate = /(\n[ \t]*super\.onCreate\([^\n]*\)\n)/
  if (superOnCreate.test(contents)) {
    return contents.replace(
      superOnCreate,
      (match, p1) => `${p1}    ${SETUP_LINE}\n`,
    )
  }

  // onCreate が無いテンプレートに備えて override を丸ごと挿入
  const classOpen = /(class\s+MainActivity[^{]*\{\n)/
  if (!classOpen.test(contents)) {
    throw new Error(
      'with-health-connect-delegate: MainActivity の class 宣言が見つからない',
    )
  }
  const onCreate = [
    '',
    '  override fun onCreate(savedInstanceState: android.os.Bundle?) {',
    '    super.onCreate(savedInstanceState)',
    `    ${SETUP_LINE}`,
    '  }',
    '',
  ].join('\n')
  return contents.replace(classOpen, `$1${onCreate}`)
}

const withMainActivityDelegate = (config) =>
  withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'with-health-connect-delegate: MainActivity は Kotlin (.kt) のみ対応',
      )
    }
    let contents = cfg.modResults.contents
    contents = addImportKotlin(contents)
    contents = insertSetupCallKotlin(contents)
    cfg.modResults.contents = contents
    return cfg
  })

const ensureActivityAlias = (modResults, mainActivityName) => {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modResults)
  if (!Array.isArray(application['activity-alias'])) {
    application['activity-alias'] = []
  }
  const aliases = application['activity-alias']
  const existing = aliases.find(
    (a) => a?.$?.['android:name'] === 'ViewPermissionUsageActivity',
  )
  if (existing) return
  aliases.push({
    $: {
      'android:name': 'ViewPermissionUsageActivity',
      'android:exported': 'true',
      'android:targetActivity': mainActivityName,
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
    },
    'intent-filter': [
      {
        action: [
          {
            $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' },
          },
        ],
        category: [
          {
            $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' },
          },
        ],
      },
    ],
  })
}

const ensureHealthDataQuery = (manifest) => {
  if (!Array.isArray(manifest.queries)) manifest.queries = []
  if (manifest.queries.length === 0) manifest.queries.push({})
  const q = manifest.queries[0]
  if (!Array.isArray(q.package)) q.package = []
  const exists = q.package.some(
    (p) => p?.$?.['android:name'] === HC_PROVIDER_PACKAGE,
  )
  if (exists) return
  q.package.push({ $: { 'android:name': HC_PROVIDER_PACKAGE } })
}

const withHealthConnectManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(
      cfg.modResults,
    )
    ensureActivityAlias(cfg.modResults, mainActivity.$['android:name'])
    ensureHealthDataQuery(cfg.modResults.manifest)
    return cfg
  })

module.exports = function withHealthConnectDelegate(config) {
  config = withMainActivityDelegate(config)
  config = withHealthConnectManifest(config)
  return config
}
