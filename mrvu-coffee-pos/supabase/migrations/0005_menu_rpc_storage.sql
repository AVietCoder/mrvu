-- MR.VŨ COFFEE POS - 0005: lưu món nguyên tử (RPC) và kho ảnh sản phẩm

-- p_data: {code, name, category_id, price, tax_rate, is_active, sort_order, image_url,
--          variants: [{id?, name, price}], modifier_ids: [uuid], cost_estimate?}
-- Biến thể bị bỏ khỏi danh sách chỉ bị ngừng dùng (không xóa) để giữ lịch sử bán hàng.
create or replace function rpc_save_product(p_store uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id; v_var jsonb; v_seen uuid[] := '{}'; v_vid uuid; v_ord int := 0;
  v_name text := trim(coalesce(p_data ->> 'name', ''));
  v_code text := trim(coalesce(p_data ->> 'code', ''));
begin
  if not has_permission(p_store, 'menu.manage') then raise exception 'Bạn không có quyền quản lý thực đơn.'; end if;
  if v_name = '' then raise exception 'Vui lòng nhập tên món.'; end if;
  if v_code = '' then raise exception 'Vui lòng nhập mã món.'; end if;
  if (p_data ->> 'price')::numeric is null or (p_data ->> 'price')::numeric < 0 then raise exception 'Giá bán không hợp lệ.'; end if;

  if nullif(p_data ->> 'category_id', '') is not null and not exists (
    select 1 from categories where id = (p_data ->> 'category_id')::uuid and store_id = p_store) then
    raise exception 'Danh mục không hợp lệ.';
  end if;

  if v_id is null then
    insert into products (store_id, category_id, code, name, image_url, price, tax_rate, is_active, sort_order)
    values (p_store, nullif(p_data ->> 'category_id', '')::uuid, v_code, v_name, nullif(p_data ->> 'image_url', ''),
            (p_data ->> 'price')::numeric, coalesce((p_data ->> 'tax_rate')::numeric, 0),
            coalesce((p_data ->> 'is_active')::boolean, true), coalesce((p_data ->> 'sort_order')::int, 0))
    returning id into v_id;
  else
    if not exists (select 1 from products where id = v_id and store_id = p_store) then raise exception 'Không tìm thấy món.'; end if;
    update products set category_id = nullif(p_data ->> 'category_id', '')::uuid, code = v_code, name = v_name,
      image_url = nullif(p_data ->> 'image_url', ''), price = (p_data ->> 'price')::numeric,
      tax_rate = coalesce((p_data ->> 'tax_rate')::numeric, 0),
      is_active = coalesce((p_data ->> 'is_active')::boolean, true), sort_order = coalesce((p_data ->> 'sort_order')::int, 0)
    where id = v_id;
  end if;

  for v_var in select * from jsonb_array_elements(coalesce(p_data -> 'variants', '[]'::jsonb)) loop
    v_ord := v_ord + 1;
    if trim(coalesce(v_var ->> 'name', '')) = '' then raise exception 'Tên biến thể không được để trống.'; end if;
    if (v_var ->> 'price')::numeric is null or (v_var ->> 'price')::numeric < 0 then raise exception 'Giá biến thể không hợp lệ.'; end if;
    if nullif(v_var ->> 'id', '') is not null then
      v_vid := (v_var ->> 'id')::uuid;
      update product_variants set name = trim(v_var ->> 'name'), price = (v_var ->> 'price')::numeric,
        is_active = true, sort_order = v_ord
      where id = v_vid and product_id = v_id;
      if not found then raise exception 'Biến thể không thuộc món này.'; end if;
    else
      insert into product_variants (product_id, store_id, name, price, sort_order)
      values (v_id, p_store, trim(v_var ->> 'name'), (v_var ->> 'price')::numeric, v_ord)
      returning id into v_vid;
    end if;
    v_seen := v_seen || v_vid;
  end loop;
  update product_variants set is_active = false where product_id = v_id and not (id = any(v_seen));

  delete from product_modifiers where product_id = v_id;
  insert into product_modifiers (product_id, modifier_id)
  select v_id, m.id from modifiers m
  where m.store_id = p_store and m.id in (select x::uuid from jsonb_array_elements_text(coalesce(p_data -> 'modifier_ids', '[]'::jsonb)) x);

  if p_data ? 'cost_estimate' and has_permission(p_store, 'costs.view') then
    insert into product_costs (product_id, store_id, cost_estimate)
    values (v_id, p_store, coalesce(nullif(p_data ->> 'cost_estimate', '')::numeric, 0))
    on conflict (product_id) do update set cost_estimate = excluded.cost_estimate;
  end if;

  perform log_audit(p_store, case when p_id is null then 'product.create' else 'product.update' end,
    'products', v_id::text, jsonb_build_object('code', v_code, 'name', v_name, 'price', (p_data ->> 'price')::numeric));
  return v_id;
end $$;
revoke all on function rpc_save_product(uuid, uuid, jsonb) from public, anon;
grant execute on function rpc_save_product(uuid, uuid, jsonb) to authenticated;

-- Kho ảnh sản phẩm (chỉ tạo khi dự án có Supabase Storage).
-- Quy ước đường dẫn: <store_id>/<tên-tệp>. Ai cũng xem được ảnh; chỉ người quản lý thực đơn mới tải lên.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-images', 'product-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy product_images_write on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
    execute $p$create policy product_images_update on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
    execute $p$create policy product_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and has_permission(((storage.foldername(name))[1])::uuid, 'menu.manage'))$p$;
  end if;
end $$;
