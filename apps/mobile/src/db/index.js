import * as SQLite from 'expo-sqlite'
import { LATEST_VERSION, MIGRATIONS } from './schema'
import { ensureFoodsSeeded } from './seed'

const DB_NAME = 'priveat.db'

let db = null
let initPromise = null

export const initDb = ({ onSeedProgress } = {}) => {
  if (initPromise) return initPromise
  initPromise = (async () => {
    db = await SQLite.openDatabaseAsync(DB_NAME)
    // PRAGMA は migrations の外で先に流す
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    await runMigrations(db)
    await ensureFoodsSeeded(db, onSeedProgress)
    return db
  })()
  return initPromise
}

export const getDb = () => {
  if (!db) {
    throw new Error('DB is not initialized. Call initDb() first.')
  }
  return db
}

const runMigrations = async (database) => {
  const currentVersion = await getUserVersion(database)
  if (currentVersion >= LATEST_VERSION) return

  for (const m of MIGRATIONS) {
    if (m.version <= currentVersion) continue
    console.log(`[db] migrating to v${m.version}`)
    // 各 migration は複数文の SQL を含むので execAsync を使う
    await database.execAsync(m.sql)
    await setUserVersion(database, m.version)
  }
  console.log(`[db] migration complete (v${LATEST_VERSION})`)
}

const getUserVersion = async (database) => {
  const row = await database.getFirstAsync('PRAGMA user_version')
  return row?.user_version ?? 0
}

const setUserVersion = async (database, version) => {
  // PRAGMA は ? バインディングを受け取らないので埋め込み（整数のみ）
  await database.execAsync(`PRAGMA user_version = ${Number(version)}`)
}
