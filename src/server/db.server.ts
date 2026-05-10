import Database from "better-sqlite3";
import path from "path";

// File db.sqlite nằm ở root project
const DB_PATH = path.resolve(process.cwd(), "db.sqlite");

const db = new Database(DB_PATH);

// Bật WAL mode cho performance tốt hơn
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Tạo bảng nếu chưa có ─────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    address    TEXT,
    phone      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    sku         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    category_id TEXT REFERENCES categories(id),
    brand       TEXT,
    power       TEXT,
    color       TEXT,
    blade_size  TEXT,
    image_url   TEXT,
    description TEXT,
    cost_price  REAL NOT NULL DEFAULT 0,
    sale_price  REAL NOT NULL DEFAULT 0,
    min_stock   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stock (
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    qty        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, branch_id)
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    product_id  TEXT REFERENCES products(id),
    from_branch TEXT REFERENCES branches(id),
    to_branch   TEXT REFERENCES branches(id),
    qty         INTEGER NOT NULL,
    unit_cost   REAL DEFAULT 0,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    created_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS customers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT,
    address    TEXT,
    group_name TEXT NOT NULL DEFAULT 'le',
    debt       REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT,
    role       TEXT NOT NULL,
    branch_id  TEXT REFERENCES branches(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id          TEXT PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    branch_id   TEXT REFERENCES branches(id),
    employee_id TEXT REFERENCES employees(id),
    status      TEXT NOT NULL DEFAULT 'draft',
    subtotal    REAL NOT NULL DEFAULT 0,
    discount    REAL NOT NULL DEFAULT 0,
    total       REAL NOT NULL DEFAULT 0,
    deposit     REAL NOT NULL DEFAULT 0,
    paid        REAL NOT NULL DEFAULT 0,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         TEXT PRIMARY KEY,
    order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id),
    qty        INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    discount   REAL NOT NULL DEFAULT 0,
    total      REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id          TEXT PRIMARY KEY,
    employee_id TEXT,
    action      TEXT NOT NULL,
    detail      TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    full_name  TEXT NOT NULL,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    phone      TEXT,
    role       TEXT NOT NULL DEFAULT 'cashier',
    branch_id  TEXT REFERENCES branches(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Seed dữ liệu mẫu nếu DB trống ───────────────────────────
function seedIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) as c FROM branches").get() as any).c;
  if (count > 0) return; // đã có data, bỏ qua

  const uid = () => Math.random().toString(36).slice(2, 10);
  const now = () => new Date().toISOString();

  // Branches
  db.prepare("INSERT INTO branches (id,name,address,phone) VALUES (?,?,?,?)").run(
    "b1","Cửa hàng chính","123 Lý Thường Kiệt, Q.10, TP.HCM","0909000001"
  );
  db.prepare("INSERT INTO branches (id,name,address,phone) VALUES (?,?,?,?)").run(
    "b2","Chi nhánh Hà Nội","55 Trường Chinh, Đống Đa, HN","0909000002"
  );

  // Categories
  const cats = [
    ["c1","Quạt trần cánh gỗ"],["c2","Quạt trần đèn LED"],
    ["c3","Quạt trần công nghiệp"],["c4","Linh kiện & phụ kiện"],
  ];
  const insC = db.prepare("INSERT INTO categories (id,name) VALUES (?,?)");
  for (const [id,name] of cats) insC.run(id,name);

  // Products
  const insP = db.prepare(`INSERT INTO products
    (id,sku,name,category_id,brand,power,color,blade_size,cost_price,sale_price,min_stock)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insP.run("p1","QT-MIT-001","Quạt trần Mitsubishi C56-RA5","c1","Mitsubishi","75W","Nâu gỗ",'56"',2200000,2890000,5);
  insP.run("p2","QT-PAN-002","Quạt trần đèn Panasonic F-60TDN","c2","Panasonic","65W","Trắng",'60"',3100000,4150000,4);
  insP.run("p3","QT-KDK-003","Quạt trần KDK K15Y0","c1","KDK","82W","Đen",'60"',2700000,3490000,6);
  insP.run("p4","QT-CN-004","Quạt trần công nghiệp HVLS 12ft","c3","MaxAir","550W","Xám",'144"',18500000,24900000,2);
  insP.run("p5","PK-RM-001","Remote điều khiển quạt trần","c4","Universal","-","Trắng","-",120000,220000,20);

  // Stock
  const insS = db.prepare("INSERT INTO stock (product_id,branch_id,qty) VALUES (?,?,?)");
  insS.run("p1","b1",12); insS.run("p1","b2",4);
  insS.run("p2","b1",3);  insS.run("p3","b1",10);
  insS.run("p4","b1",1);  insS.run("p5","b1",35);
  insS.run("p5","b2",18);

  // Customers
  const insK = db.prepare("INSERT INTO customers (id,name,phone,address,group_name,debt) VALUES (?,?,?,?,?,?)");
  insK.run("k1","Anh Tuấn (khách lẻ)","0912345678","Q.3, TP.HCM","le",0);
  insK.run("k2","Đại lý Minh Phát","0987111222","Bình Dương","dai_ly",5400000);
  insK.run("k3","Công trình Sunrise Tower","0933555666","Q.7, TP.HCM","cong_trinh",12500000);
  insK.run("k4","Chị Hoa (VIP)","0901222333","Q.1, TP.HCM","vip",0);

  // Employees
  const insE = db.prepare("INSERT INTO employees (id,name,phone,role,branch_id) VALUES (?,?,?,?,?)");
  insE.run("e1","Nguyễn Văn A","0900000001","admin","b1");
  insE.run("e2","Trần Thị B","0900000002","cashier","b1");
  insE.run("e3","Lê Văn C","0900000003","warehouse","b1");
  insE.run("e4","Phạm D","0900000004","manager","b2");

  // Orders + items
  const oid = uid();
  db.prepare(`INSERT INTO orders
    (id,code,customer_id,branch_id,employee_id,status,subtotal,discount,total,deposit,paid,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(oid,"HD000001","k2","b1","e2","completed",5780000,280000,5500000,0,5500000,"Giao tận đại lý");
  db.prepare(`INSERT INTO order_items (id,order_id,product_id,qty,unit_price,discount,total)
    VALUES (?,?,?,?,?,?,?)`)
    .run(uid(),oid,"p1",2,2890000,280000,5500000);

  // Movements
  db.prepare(`INSERT INTO stock_movements (id,type,product_id,to_branch,qty,unit_cost,note)
    VALUES (?,?,?,?,?,?,?)`)
    .run(uid(),"in","p1","b1",16,2200000,"Nhập từ NCC Mitsubishi");

  // Users — mrvu / Mrvu@1102
  const insU = db.prepare(`INSERT INTO users (id,full_name,username,password,phone,role,branch_id)
    VALUES (?,?,?,?,?,?,?)`);
  insU.run("u1","Mr. Vũ (Admin)","mrvu","Mrvu@1102","0900000000","admin",null);
  insU.run("u2","Nhân viên B1","nhanvien_b1","123456","0900000011","cashier","b1");
  insU.run("u3","Nhân viên B2","nhanvien_b2","123456","0900000022","warehouse","b2");

  console.log("✅ SQLite seeded!");
}

seedIfEmpty();

export default db;
export const uid = () => Math.random().toString(36).slice(2, 10);
export const now = () => new Date().toISOString();