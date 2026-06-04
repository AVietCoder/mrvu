import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const SUPABASE_URL =
  'https://nzpddacinmsdyrpkpvef.supabase.co';

const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56cGRkYWNpbm1zZHlycGtwdmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3Nzg5NDUsImV4cCI6MjA5NTM1NDk0NX0.j5QpStb_BW1RxdtxLktnzp93lAJR2PGrPpXHa4Rh9P4';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const tables = [
  'schedules',
  'stock_transfers',
  'user_branches',
  'user_permissions',
  'user_activity_logs',
  'cash_vouchers',
  'stock_movements',
  'cash_voucher_types',
  'work_types',
  'customers',
  'branches',
  'work_difficulties',
  'activity_logs',
  'stock_transfer_items',
  'site_settings',
  'products',
  'categories',
  'brands',
  'users',
  'orders',
  'order_items',
  'employees',
  'stock',
  'schedule_assignments',
  'schedule_difficulties',
  'tech_fees'
];

async function getAllRows(table) {
  const pageSize = 1000;
  let from = 0;
  let rows = [];

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`Lỗi bảng ${table}:`, error.message);
      break;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);
    from += pageSize;
  }

  return rows;
}

async function exportDatabase() {
  const result = {};

  for (const table of tables) {
    console.log(`Đang export ${table}...`);

    result[table] = await getAllRows(table);

    console.log(
      `${table}: ${result[table].length} records`
    );
  }

  fs.writeFileSync(
    'database.json',
    JSON.stringify(result, null, 2),
    'utf8'
  );

  console.log('Export xong database.json');
}

exportDatabase();