-- MR.VŨ COFFEE POS: dữ liệu MẪU để chạy thử (thực đơn, bàn, nguyên liệu, công thức).
-- Đây là dữ liệu minh họa, KHÔNG phải thực đơn thật của quán. Xóa hoặc sửa trong ứng dụng trước khi bán thật.
-- Chạy trong SQL Editor SAU KHI đã tạo cửa hàng ở màn hình "Khởi tạo cửa hàng". An toàn khi chạy lại (bỏ qua nếu đã có món).
do $$
declare
  s uuid; c_cf uuid; c_tr uuid; c_bn uuid; m_top uuid; m_duong uuid; m_da uuid;
  p_cf uuid; p_cfs uuid; p_td uuid; p_bm uuid; v_m uuid; v_l uuid;
  i_cf uuid; i_sua uuid; i_tra uuid; i_duong uuid;
begin
  select id into s from stores order by created_at limit 1;
  if s is null then raise exception 'Chưa có cửa hàng. Hãy đăng nhập ứng dụng và tạo cửa hàng trước.'; end if;
  if exists (select 1 from products where store_id = s) then raise notice 'Đã có món, bỏ qua dữ liệu mẫu.'; return; end if;

  insert into categories (store_id, name, sort_order) values (s, 'Cà phê', 1) returning id into c_cf;
  insert into categories (store_id, name, sort_order) values (s, 'Trà', 2) returning id into c_tr;
  insert into categories (store_id, name, sort_order) values (s, 'Bánh', 3) returning id into c_bn;

  insert into products (store_id, category_id, code, name, price, sort_order) values (s, c_cf, 'CF01', 'Cà phê đen', 20000, 1) returning id into p_cf;
  insert into products (store_id, category_id, code, name, price, sort_order) values (s, c_cf, 'CF02', 'Cà phê sữa', 25000, 2) returning id into p_cfs;
  insert into products (store_id, category_id, code, name, price, sort_order) values (s, c_tr, 'TR01', 'Trà đào', 35000, 1) returning id into p_td;
  insert into products (store_id, category_id, code, name, price, sort_order) values (s, c_bn, 'BN01', 'Bánh mì que', 15000, 1) returning id into p_bm;

  insert into product_variants (product_id, store_id, name, price, sort_order) values (p_cfs, s, 'Size M', 25000, 1) returning id into v_m;
  insert into product_variants (product_id, store_id, name, price, sort_order) values (p_cfs, s, 'Size L', 30000, 2) returning id into v_l;

  insert into modifiers (store_id, name, min_select, max_select, sort_order) values (s, 'Topping', 0, 3, 1) returning id into m_top;
  insert into modifier_options (modifier_id, store_id, name, price_delta, sort_order) values (m_top, s, 'Trân châu', 5000, 1), (m_top, s, 'Thạch', 3000, 2);
  insert into product_modifiers (product_id, modifier_id) values (p_cfs, m_top), (p_td, m_top);

  -- Đường/đá: không bắt buộc chọn (mặc định = bình thường), chọn nhanh một chạm trong hộp "Tùy chọn".
  insert into modifiers (store_id, name, min_select, max_select, sort_order) values (s, 'Mức đường', 0, 1, 2) returning id into m_duong;
  insert into modifier_options (modifier_id, store_id, name, price_delta, sort_order) values
    (m_duong, s, 'Ít đường', 0, 1), (m_duong, s, 'Không đường', 0, 2), (m_duong, s, 'Nhiều đường', 0, 3);
  insert into modifiers (store_id, name, min_select, max_select, sort_order) values (s, 'Mức đá', 0, 1, 3) returning id into m_da;
  insert into modifier_options (modifier_id, store_id, name, price_delta, sort_order) values
    (m_da, s, 'Ít đá', 0, 1), (m_da, s, 'Không đá', 0, 2), (m_da, s, 'Nhiều đá', 0, 3);
  insert into product_modifiers (product_id, modifier_id) values (p_cf, m_duong), (p_cf, m_da), (p_cfs, m_duong), (p_cfs, m_da), (p_td, m_duong), (p_td, m_da);

  insert into tables (store_id, name, area) values (s, 'A1', 'Tầng 1'), (s, 'A2', 'Tầng 1'), (s, 'A3', 'Tầng 1'), (s, 'B1', 'Sân vườn');

  insert into ingredients (store_id, name, unit, min_stock) values (s, 'Cà phê hạt', 'g', 500) returning id into i_cf;
  insert into ingredients (store_id, name, unit, min_stock) values (s, 'Sữa đặc', 'ml', 500) returning id into i_sua;
  insert into ingredients (store_id, name, unit, min_stock) values (s, 'Trà đào túi lọc', 'cái', 20) returning id into i_tra;
  insert into ingredients (store_id, name, unit, min_stock) values (s, 'Đường', 'g', 500) returning id into i_duong;
  insert into stock_movements (store_id, ingredient_id, type, quantity, reason) values
    (s, i_cf, 'opening', 2000, 'Tồn đầu (dữ liệu mẫu)'), (s, i_sua, 'opening', 3000, 'Tồn đầu (dữ liệu mẫu)'),
    (s, i_tra, 'opening', 100, 'Tồn đầu (dữ liệu mẫu)'), (s, i_duong, 'opening', 2000, 'Tồn đầu (dữ liệu mẫu)');

  insert into product_recipes (store_id, product_id, variant_id, ingredient_id, quantity) values
    (s, p_cf, null, i_cf, 18),
    (s, p_cfs, null, i_cf, 18), (s, p_cfs, null, i_sua, 30),
    (s, p_td, null, i_tra, 1), (s, p_td, null, i_duong, 15);
  raise notice 'Đã thêm dữ liệu mẫu cho cửa hàng %.', s;
end $$;
