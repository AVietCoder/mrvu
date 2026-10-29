-- MR.VŨ COFFEE POS - 0006: in bill qua QZ Tray / giả lập, quyền in lại, chặn in trùng

-- Phương thức in: QZ Tray (thật), giả lập (thử nghiệm), hộp thoại trình duyệt (dự phòng).
alter table print_settings drop constraint if exists print_settings_method_check;
update print_settings set method = 'simulator' where method not in ('qz_tray', 'simulator', 'browser');
alter table print_settings add constraint print_settings_method_check check (method in ('qz_tray', 'simulator', 'browser'));
alter table print_settings alter column method set default 'simulator';

-- Mỗi hóa đơn chỉ có MỘT lệnh in tự động (kind = 'receipt'); in lại dùng kind = 'reprint' kèm lý do.
create unique index if not exists print_jobs_one_receipt on receipt_print_jobs (receipt_id) where kind = 'receipt';

-- Quyền in lại hóa đơn.
insert into role_permissions (role, permission) values
  ('owner', 'order.reprint'), ('manager', 'order.reprint'), ('cashier', 'order.reprint')
on conflict do nothing;

drop policy if exists print_jobs_insert on receipt_print_jobs;
create policy print_jobs_insert on receipt_print_jobs for insert to authenticated
  with check (
    requested_by = auth.uid()
    and case
      when kind = 'reprint' then has_permission(store_id, 'order.reprint') and length(trim(coalesce(reason, ''))) >= 3
      when kind = 'test' then has_permission(store_id, 'settings.manage')
      else has_permission(store_id, 'order.create')
    end
  );
