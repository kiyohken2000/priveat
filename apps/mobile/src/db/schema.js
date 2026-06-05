// 仕様書 §5 のデータモデル。すべて一度に作成する（テーブルは空で作るだけなのでコスト低）。
// FTS5 など検索用の派生は、検索機能を実装するフェーズで v2 マイグレーションとして追加する。

export const MIGRATIONS = [
  // v1: 初期テーブル一式
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS foods (
        id INTEGER PRIMARY KEY,
        food_code TEXT,
        name TEXT NOT NULL,
        name_kana TEXT,
        category TEXT,
        kcal_per_100g REAL,
        protein_per_100g REAL,
        fat_per_100g REAL,
        carb_per_100g REAL,
        salt_per_100g REAL
      );
      CREATE INDEX IF NOT EXISTS idx_foods_name ON foods(name);

      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT,
        name TEXT NOT NULL,
        kcal REAL,
        protein REAL,
        fat REAL,
        carb REAL,
        salt REAL,
        serving_desc TEXT,
        source TEXT,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

      CREATE TABLE IF NOT EXISTS dishes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        default_kcal REAL,
        default_protein REAL,
        default_fat REAL,
        default_carb REAL,
        portion_options TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dishes_name ON dishes(name);

      CREATE TABLE IF NOT EXISTS food_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eaten_at TEXT NOT NULL,
        meal_type TEXT,
        name TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        portion TEXT,
        kcal REAL,
        protein REAL,
        fat REAL,
        carb REAL,
        salt REAL,
        ref_food_id INTEGER,
        ref_kind TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_food_log_eaten_at ON food_log(eaten_at);

      CREATE TABLE IF NOT EXISTS weight_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        measured_at TEXT NOT NULL,
        weight_kg REAL NOT NULL,
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS energy_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logged_at TEXT NOT NULL,
        active_kcal REAL,
        basal_kcal REAL,
        steps INTEGER,
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        role TEXT,
        text TEXT,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        height_cm REAL,
        age INTEGER,
        sex TEXT,
        target_weight_kg REAL,
        daily_kcal_target REAL
      );
    `,
  },
  // v2: OCR の入力画像パスを保持するための image_uri 列を追加。
  //   後でユーザーが履歴から「どの画像を読んだか」を確認できるようにするため。
  //   既存行は NULL のままで OK（画像なし表示）。
  {
    version: 2,
    sql: `
      ALTER TABLE weight_log ADD COLUMN image_uri TEXT;
      ALTER TABLE energy_log ADD COLUMN image_uri TEXT;
      ALTER TABLE products   ADD COLUMN image_uri TEXT;
    `,
  },
  // v3: コーチからのアドバイスをキャッシュ。
  //   date (YYYY-MM-DD) が PK。snapshot_hash が当日の入力データ＋スタンス＋モデルから
  //   算出されるハッシュで、これが変わったら再生成促し（UI で stale 表示）。
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS coach_advice (
        date TEXT PRIMARY KEY,
        snapshot_hash TEXT,
        advice_text TEXT NOT NULL,
        model_id TEXT,
        generated_at TEXT NOT NULL
      );
    `,
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
