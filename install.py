import psycopg2
import sqlite3

# Kết nối bằng params riêng lẻ thay vì URL
pg = psycopg2.connect(
    host="nzpddacinmsdyrpkpvef.supabase.co",
    port=6543,
    database="postgres",
    user="postgres",
    password="Mrvu@16302000",
    sslmode="require",
    connect_timeout=10
)

SQLITE_FILE = "output.sqlite"
pg_cur = pg.cursor()

# Lấy danh sách bảng
pg_cur.execute("""
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
""")
tables = [row[0] for row in pg_cur.fetchall()]
print(f"Tìm thấy {len(tables)} bảng: {tables}")

sq = sqlite3.connect(SQLITE_FILE)
sq_cur = sq.cursor()

for table in tables:
    print(f"Đang copy bảng: {table}")
    
    pg_cur.execute(f"""
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = %s AND table_schema = 'public'
        ORDER BY ordinal_position
    """, (table,))
    columns = pg_cur.fetchall()
    
    type_map = {
        'integer': 'INTEGER', 'bigint': 'INTEGER', 'smallint': 'INTEGER',
        'boolean': 'INTEGER', 'text': 'TEXT', 'varchar': 'TEXT',
        'character varying': 'TEXT', 'uuid': 'TEXT', 'json': 'TEXT',
        'jsonb': 'TEXT', 'timestamp without time zone': 'TEXT',
        'timestamp with time zone': 'TEXT', 'date': 'TEXT',
        'numeric': 'REAL', 'double precision': 'REAL', 'float': 'REAL',
        'bytea': 'BLOB'
    }
    
    col_defs = ", ".join([f'"{c[0]}" {type_map.get(c[1], "TEXT")}' for c in columns])
    sq_cur.execute(f'DROP TABLE IF EXISTS "{table}"')
    sq_cur.execute(f'CREATE TABLE "{table}" ({col_defs})')
    
    pg_cur.execute(f'SELECT * FROM "{table}"')
    rows = pg_cur.fetchall()
    print(f"  → {len(rows)} dòng")
    
    if rows:
        placeholders = ", ".join(["?" for _ in columns])
        sq_cur.executemany(
            f'INSERT INTO "{table}" VALUES ({placeholders})',
            [tuple(str(v) if v is not None else None for v in row) for row in rows]
        )

sq.commit()
sq.close()
pg.close()
print(f"✅ Xong! File SQLite: {SQLITE_FILE}")