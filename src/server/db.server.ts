import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "db.sqlite");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    address TEXT, phone TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    brand_id TEXT REFERENCES brands(id),
    power TEXT, color TEXT, blade_size TEXT,
    image_url TEXT, description TEXT,
    cost_price REAL NOT NULL DEFAULT 0,
    sale_price REAL NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 0,
    tech_fee REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS stock (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, branch_id)
  );
  CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY, type TEXT NOT NULL,
    product_id TEXT REFERENCES products(id),
    from_branch TEXT REFERENCES branches(id),
    to_branch   TEXT REFERENCES branches(id),
    qty INTEGER NOT NULL, unit_cost REAL DEFAULT 0,
    note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
  );

  -- Phiếu chuyển kho chờ xác nhận
  CREATE TABLE IF NOT EXISTS stock_transfers (
    id TEXT PRIMARY KEY,
    from_branch TEXT NOT NULL REFERENCES branches(id),
    to_branch   TEXT NOT NULL REFERENCES branches(id),
    status TEXT NOT NULL DEFAULT 'pending',
    note TEXT, created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    phone TEXT,
    ward TEXT, district TEXT, province TEXT, address TEXT,
    group_name TEXT NOT NULL DEFAULT 'le',
    debt REAL NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    branch_id   TEXT REFERENCES branches(id),
    employee_id TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0, deposit REAL NOT NULL DEFAULT 0,
    paid REAL NOT NULL DEFAULT 0, note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    qty INTEGER NOT NULL, unit_price REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY, employee_id TEXT,
    action TEXT NOT NULL, detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, full_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    phone TEXT, is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_branches (
    user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, branch_id)
  );
  CREATE TABLE IF NOT EXISTS user_permissions (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (user_id, permission)
  );

  -- Lịch làm việc
  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY, title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'install',
    status TEXT NOT NULL DEFAULT 'pending',
    scheduled_date TEXT NOT NULL,
    scheduled_time TEXT,
    customer_id TEXT REFERENCES customers(id),
    branch_id TEXT REFERENCES branches(id),
    order_id TEXT REFERENCES orders(id),
    address TEXT, note TEXT,
    created_by TEXT NOT NULL,
    assigned_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedule_assignments (
    schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (schedule_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS schedule_difficulties (
    schedule_id    TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    difficulty_id  TEXT NOT NULL,
    PRIMARY KEY (schedule_id, difficulty_id)
  );

  -- Tính chất công việc
  CREATE TABLE IF NOT EXISTS work_difficulties (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    description TEXT, bonus REAL NOT NULL DEFAULT 0
  );

  -- Tiền công theo sản phẩm / lịch
  CREATE TABLE IF NOT EXISTS tech_fees (
    schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    product_id  TEXT NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL DEFAULT 1,
    unit_fee REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (schedule_id, product_id)
  );
`);

// ── Site settings table ───────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ── Migrations ────────────────────────────────────────────────
const migrations = [
  `ALTER TABLE customers ADD COLUMN ward TEXT`,
  `ALTER TABLE customers ADD COLUMN district TEXT`,
  `ALTER TABLE customers ADD COLUMN province TEXT`,
  `ALTER TABLE customers ADD COLUMN created_by TEXT`,
  `ALTER TABLE products ADD COLUMN brand_id TEXT`,
  `ALTER TABLE products ADD COLUMN tech_fee REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE schedules ADD COLUMN assigned_by TEXT`,
];
for (const m of migrations) {
  try { db.exec(m); } catch {}
}

// ── Seed ─────────────────────────────────────────────────────
function seedIfEmpty() {
  const c = (db.prepare("SELECT COUNT(*) as c FROM branches").get() as any).c;
  if (c > 0) return;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();

  db.prepare("INSERT INTO branches (id,name,address,phone) VALUES (?,?,?,?)").run("b1","Cửa hàng chính","123 Lý Thường Kiệt, Q.10, TP.HCM","0909000001");
  db.prepare("INSERT INTO branches (id,name,address,phone) VALUES (?,?,?,?)").run("b2","Chi nhánh Hà Nội","55 Trường Chinh, Đống Đa, HN","0909000002");

  // Brands
  db.prepare("INSERT INTO brands (id,name) VALUES (?,?)").run("br1","Mitsubishi");
  db.prepare("INSERT INTO brands (id,name) VALUES (?,?)").run("br2","Panasonic");
  db.prepare("INSERT INTO brands (id,name) VALUES (?,?)").run("br3","KDK");
  db.prepare("INSERT INTO brands (id,name) VALUES (?,?)").run("br4","Mr.Vũ");

  // Categories
  const cats = [["c1","Quạt trần cánh gỗ"],["c2","Quạt trần đèn LED"],["c3","Quạt trần công nghiệp"],["c4","Linh kiện & phụ kiện"]];
  for (const [id,name] of cats) db.prepare("INSERT INTO categories (id,name) VALUES (?,?)").run(id,name);

  // Products
  const insP = db.prepare(`INSERT INTO products (id,sku,name,category_id,brand_id,power,color,blade_size,cost_price,sale_price,min_stock,tech_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insP.run("p1","QT-MIT-001","Quạt trần Mitsubishi C56-RA5","c1","br1","75W","Nâu gỗ",'56"',2200000,2890000,5,200000);
  insP.run("p2","QT-PAN-002","Quạt trần đèn Panasonic F-60TDN","c2","br2","65W","Trắng",'60"',3100000,4150000,4,200000);
  insP.run("p3","QT-KDK-003","Quạt trần KDK K15Y0","c1","br3","82W","Đen",'60"',2700000,3490000,6,200000);
  insP.run("p4","QT-CN-004","Quạt trần CN HVLS 12ft","c3",null,"550W","Xám",'144"',18500000,24900000,2,800000);
  insP.run("p5","PK-RM-001","Remote điều khiển quạt trần","c4",null,"-","Trắng","-",120000,220000,20,0);

  const insS = db.prepare("INSERT INTO stock (product_id,branch_id,qty) VALUES (?,?,?)");
  insS.run("p1","b1",12); insS.run("p1","b2",4); insS.run("p2","b1",3);
  insS.run("p3","b1",10); insS.run("p4","b1",1); insS.run("p5","b1",35); insS.run("p5","b2",18);

  const insK = db.prepare("INSERT INTO customers (id,name,phone,province,address,group_name,debt) VALUES (?,?,?,?,?,?,?)");
  insK.run("k1","Anh Tuấn (khách lẻ)","0912345678","TP. Hồ Chí Minh","Q.3","le",0);
  insK.run("k2","Đại lý Minh Phát","0987111222","Bình Dương","Thủ Dầu Một","dai_ly",5400000);
  insK.run("k3","Công trình Sunrise Tower","0933555666","TP. Hồ Chí Minh","Q.7","cong_trinh",12500000);
  insK.run("k4","Chị Hoa (VIP)","0901222333","TP. Hồ Chí Minh","Q.1","vip",0);

  // Work difficulties
  db.prepare("INSERT INTO work_difficulties (id,name,description,bonus) VALUES (?,?,?,?)").run("wd1","Lắp khó","Trần cao, phức tạp",3000000);
  db.prepare("INSERT INTO work_difficulties (id,name,description,bonus) VALUES (?,?,?,?)").run("wd2","Địa hình hiểm trở","Vùng sâu, khó di chuyển",2000000);
  db.prepare("INSERT INTO work_difficulties (id,name,description,bonus) VALUES (?,?,?,?)").run("wd3","Đi xa","Cách trên 50km",1000000);

  // Users
  db.prepare("INSERT INTO users (id,full_name,username,password,phone,is_admin) VALUES (?,?,?,?,?,?)").run("u1","Mr. Vũ (Admin)","mrvu","Mrvu@1102","0900000000",1);
  db.prepare("INSERT INTO users (id,full_name,username,password,phone,is_admin) VALUES (?,?,?,?,?,?)").run("u2","Trần Thị B","nhanvien_b1","123456","0900000011",0);
  db.prepare("INSERT INTO users (id,full_name,username,password,phone,is_admin) VALUES (?,?,?,?,?,?)").run("u3","Lê Văn C","nhanvien_b2","123456","0900000022",0);

  db.prepare("INSERT INTO user_branches VALUES (?,?)").run("u2","b1");
  db.prepare("INSERT INTO user_branches VALUES (?,?)").run("u3","b2");
  db.prepare("INSERT INTO user_permissions VALUES (?,?)").run("u2","create_order");
  db.prepare("INSERT INTO user_permissions VALUES (?,?)").run("u3","technician");
  db.prepare("INSERT INTO user_permissions VALUES (?,?)").run("u3","create_schedule");

  const oid = uid();
  db.prepare(`INSERT INTO orders (id,code,customer_id,branch_id,employee_id,status,subtotal,discount,total,deposit,paid,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(oid,"HD000001","k2","b1","u2","completed",5780000,280000,5500000,0,5500000,"Giao tận đại lý");
  db.prepare(`INSERT INTO order_items (id,order_id,product_id,qty,unit_price,discount,total) VALUES (?,?,?,?,?,?,?)`)
    .run(uid(),oid,"p1",2,2890000,280000,5500000);

  // Lịch mẫu
  const sid = uid();
  db.prepare(`INSERT INTO schedules (id,title,type,status,scheduled_date,scheduled_time,customer_id,branch_id,address,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(sid,"Lắp đặt quạt Mitsubishi - Anh Tuấn","install","approved","2026-05-20","09:00","k1","b1","Q.3, TP.HCM","u1");
  db.prepare("INSERT INTO schedule_assignments VALUES (?,?)").run(sid,"u3");

  console.log("✅ SQLite seeded!");
}
seedIfEmpty();

export default db;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const now = () => new Date().toISOString();