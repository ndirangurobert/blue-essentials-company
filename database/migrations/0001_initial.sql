PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','employee')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  selling_price REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_number TEXT,
  purchase_date TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  sale_date TEXT NOT NULL,
  total REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','part-paid')),
  recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','processing','ready','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
