-- MR.VŨ COFFEE POS - 0010: Fast Takeaway - hàng đợi pha chế, không chặn thu ngân, in phiếu bếp một lần

-- Trạng thái pha chế: queued (chờ) -> preparing (đang pha) -> ready (xong, chờ giao) -> served (đã giao).
alter table orders
  add column if not exists prep_status text check (prep_status in ('queued', 'preparing', 'ready', 'served')),
  add column if not exists prep_updated_at timestamptz,
  add column if not exists prep_updated_by uuid references profiles(id);
create index if not exists orders_prep_idx on orders (store_id, created_at) where prep_status in ('queued', 'preparing', 'ready');

-- Đơn vào hàng đợi pha chế khi: đã thanh toán, hoặc đơn tại bàn được xác nhận phục vụ.
create or replace function orders_prep_default() returns trigger
language plpgsql as $$
begin
  if new.prep_status is null
     and (new.status = 'paid' or (new.type = 'dine_in' and new.status in ('open', 'pending_payment'))) then
    new.prep_status := 'queued';
    new.prep_updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_prep on orders;
create trigger trg_orders_prep before insert or update on orders for each row execute function orders_prep_default();

-- Đổi trạng thái pha chế KHÔNG làm tăng version của đơn, để không gây xung đột khi thu ngân đang sửa cùng đơn tại bàn.
create or replace function orders_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_disc numeric;
begin
  if tg_op = 'UPDATE' and (new.discount_amount is distinct from old.discount_amount
       or new.discount_percent is distinct from old.discount_percent)
     and not has_permission(new.store_id, 'discount.apply') then
    raise exception 'Bạn không có quyền áp dụng giảm giá.';
  end if;
  if tg_op = 'INSERT' and (new.discount_amount <> 0 or new.discount_percent <> 0)
     and not has_permission(new.store_id, 'discount.apply') then
    raise exception 'Bạn không có quyền áp dụng giảm giá.';
  end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'prep_status' - 'prep_updated_at' - 'prep_updated_by' - 'updated_at' - 'version')
       is distinct from (to_jsonb(old) - 'prep_status' - 'prep_updated_at' - 'prep_updated_by' - 'updated_at' - 'version') then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  v_disc := least(new.subtotal, new.discount_amount + round(new.subtotal * new.discount_percent / 100));
  new.total := new.subtotal - v_disc + new.surcharge;
  return new;
end $$;

create or replace function rpc_set_prep_status(p_order uuid, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Không tìm thấy đơn.'; end if;
  if not has_permission(o.store_id, 'order.create') then raise exception 'Bạn không có quyền cập nhật pha chế.'; end if;
  if p_status not in ('queued', 'preparing', 'ready', 'served') then raise exception 'Trạng thái pha chế không hợp lệ.'; end if;
  if o.status in ('cancelled', 'refunded', 'draft') then raise exception 'Đơn ở trạng thái % không có trong hàng đợi pha chế.', o.status; end if;
  if o.prep_status is null then raise exception 'Đơn chưa vào hàng đợi pha chế.'; end if;
  if o.prep_status = p_status then return o.prep_status; end if; -- gọi lại cho kết quả như cũ
  perform set_config('app.allow_final_edit', 'on', true);
  update orders set prep_status = p_status, prep_updated_at = now(), prep_updated_by = auth.uid() where id = o.id;
  perform set_config('app.allow_final_edit', 'off', true);
  return p_status;
end $$;
revoke all on function rpc_set_prep_status(uuid, text) from public, anon;
grant execute on function rpc_set_prep_status(uuid, text) to authenticated;

-- Mỗi đơn chỉ có một phiếu bếp tự động (in lại dùng retry trên chính lệnh đó).
create unique index if not exists print_jobs_one_kitchen on receipt_print_jobs (order_id) where kind = 'kitchen';
