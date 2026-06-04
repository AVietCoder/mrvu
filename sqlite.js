import fs from 'fs';
import Database from 'better-sqlite3';

const jsonData = JSON.parse(
  fs.readFileSync('database.json', 'utf8')
);

const db = new Database('database.sqlite');

function getSQLiteType(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  }

  if (typeof value === 'boolean') {
    return 'INTEGER';
  }

  return 'TEXT';
}

for (const [tableName, rows] of Object.entries(jsonData)) {
  console.log(`Processing ${tableName}`);

  if (!rows || rows.length === 0) {
    continue;
  }

  const sample = rows[0];

  const columns = Object.entries(sample)
    .map(([key, value]) => {
      return `"${key}" ${getSQLiteType(value)}`;
    })
    .join(', ');

  db.exec(`
    DROP TABLE IF EXISTS "${tableName}";
  `);

  db.exec(`
    CREATE TABLE "${tableName}" (
      ${columns}
    );
  `);

  const keys = Object.keys(sample);

  const placeholders = keys
    .map(() => '?')
    .join(',');

  const stmt = db.prepare(`
    INSERT INTO "${tableName}"
    (${keys.map(k => `"${k}"`).join(',')})
    VALUES (${placeholders})
  `);

  const insertMany = db.transaction((records) => {
    for (const row of records) {
      stmt.run(
        keys.map(k => {
          const value = row[k];

          if (
            value !== null &&
            typeof value === 'object'
          ) {
            return JSON.stringify(value);
          }

          return value;
        })
      );
    }
  });

  insertMany(rows);

  console.log(
    `${tableName}: ${rows.length} rows inserted`
  );
}

db.close();

console.log('database.sqlite created');