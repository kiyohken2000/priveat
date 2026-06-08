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
  // v4: テキスト経由の活動量記録に必要な列を energy_log に追加。
  //   activity_name TEXT: 種目名 ('ランニング' / 'ウォーキング' 等)
  //   duration_min  REAL: 時間 (分)。距離入力は MET 辞書の想定速度で時間に換算してから保存
  //   既存の OCR 行は NULL のまま (集計表示で問題なし)。
  {
    version: 4,
    sql: `
      ALTER TABLE energy_log ADD COLUMN activity_name TEXT;
      ALTER TABLE energy_log ADD COLUMN duration_min REAL;
    `,
  },
  // v5: 食品データソースの多重化 (八訂 + Slism)。
  //   - source TEXT: 'mext' (八訂) / 'slism'
  //   - alt_name TEXT: 別名 (Slism は alternateName で持っている)
  //   - fiber_per_100g REAL: 食物繊維 (Slism は持っている)
  //   - serving_size_g REAL / kcal_per_serving REAL: Slism の 1 食分参考値
  //   既存行は source='mext' で埋める。
  {
    version: 5,
    sql: `
      ALTER TABLE foods ADD COLUMN source TEXT;
      ALTER TABLE foods ADD COLUMN alt_name TEXT;
      ALTER TABLE foods ADD COLUMN fiber_per_100g REAL;
      ALTER TABLE foods ADD COLUMN serving_size_g REAL;
      ALTER TABLE foods ADD COLUMN kcal_per_serving REAL;
      UPDATE foods SET source = 'mext' WHERE source IS NULL;
      CREATE INDEX IF NOT EXISTS idx_foods_source ON foods(source);
    `,
  },
  // v6: food_log.kcal の出どころを記録する kcal_source カラムを追加。
  //   - 'db'           : 食品 DB マッチ → computeKcalFromMatch の値
  //   - 'llm_estimate' : DB ヒットなしで LLM の estimated_kcal を採用
  //   - 'manual'       : ユーザーが手で kcal を入力 / 編集 (db/llm_estimate を上書き)
  //   - NULL           : 既存行 (源不明)。kcal が NULL の行も含む
  //   FoodCard で 'llm_estimate' を「(推定)」バッジで明示し、健康判断への
  //   誤用を防ぐ目的。
  {
    version: 6,
    sql: `
      ALTER TABLE food_log ADD COLUMN kcal_source TEXT;
    `,
  },
  // v7: 週次サマリー用のアドバイスキャッシュ。日次の coach_advice と別建て。
  //   week_start (YYYY-MM-DD) が PK。week_start から +6 日までの 7 日間が対象。
  //   日次と同じく snapshot_hash で stale 判定する。
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS coach_weekly_advice (
        week_start TEXT PRIMARY KEY,
        snapshot_hash TEXT,
        advice_text TEXT NOT NULL,
        model_id TEXT,
        generated_at TEXT NOT NULL
      );
    `,
  },
  // v8: 自炊レシピ (まとめ作り) のマスタとその材料行。
  //   - recipes: 「カレー (5食分, total=2400 kcal)」のような完成料理マスタ。
  //     1食あたり kcal を kcal_per_serving に冗長保存 (total/servings の除算結果)。
  //     findBestFood が完全一致で recipes を優先する際に使う。
  //   - recipe_ingredients: 材料の内訳。後から見直し/再計算ができるよう残す。
  //     matched_food_id は foods 行への参照 (NULL なら DB ヒットなしの推定行)。
  //   - food_log.ref_kind='recipe' で参照する形 (既存 ref_food_id を流用)。
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        servings REAL NOT NULL,
        total_kcal REAL,
        kcal_per_serving REAL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes(name);

      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity REAL,
        unit TEXT,
        matched_food_id INTEGER,
        kcal REAL,
        kcal_source TEXT,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id
        ON recipe_ingredients(recipe_id);
    `,
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
