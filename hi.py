import pandas as pd
import os

def update_inventory(file_a_path, file_b_path, output_path="inventory_final.xlsx"):
    print("=== ĐANG XỬ LÝ CẬP NHẬT TỒN KHO ===")
    
    # 1. Đọc dữ liệu từ file A (Chứa cột 'Tên hàng' và 'Tổng tồn')
    if file_a_path.endswith('.csv'):
        df_a = pd.read_csv(file_a_path)
    else:
        df_a = pd.read_excel(file_a_path)
        
    # 2. Đọc dữ liệu từ file B (File gốc cần được sửa cột 'Tồn kho')
    if file_b_path.endswith('.csv'):
        df_b = pd.read_csv(file_b_path)
    else:
        df_b = pd.read_excel(file_b_path)

    # Chuẩn hóa loại bỏ khoảng trắng thừa ở tiêu đề các cột
    df_a.columns = df_a.columns.str.strip()
    df_b.columns = df_b.columns.str.strip()

    # Tự động tìm cột chứa số lượng tồn kho ở file A (Tổng tồn hoặc Tồn kho)
    col_ton_a = None
    for col in ['Tổng tồn kho', 'Tổng Tồn', 'Tồn kho', 'Tồn Kho']:
        if col in df_a.columns:
            col_ton_a = col
            break
            
    if col_ton_a is None:
        print("❌ Lỗi: Không tìm thấy cột chứa số lượng tồn ở file A!")
        print("Các cột hiện có trong file A là:", list(df_a.columns))
        return

    # Tìm cột định danh 'Tên hàng' trong cả 2 file
    col_ten_a = 'Tên hàng' if 'Tên hàng' in df_a.columns else ('Tên sản phẩm' if 'Tên sản phẩm' in df_a.columns else None)
    col_ten_b = 'Tên hàng' if 'Tên hàng' in df_b.columns else ('Tên sản phẩm' if 'Tên sản phẩm' in df_b.columns else None)
    
    if not col_ten_a or not col_ten_b:
        print(f"❌ Lỗi: Không tìm thấy cột tên hàng tương ứng. File A: {col_ten_a}, File B: {col_ten_b}")
        return

    print(f"-> Khớp sản phẩm qua cột: '{col_ten_a}'")
    print(f"-> Lấy dữ liệu từ cột '{col_ton_a}' (file A) ghi đè sang cột 'Tồn kho' (file B).")

    # 3. Tính tổng tồn kho ở file A theo từng Tên hàng (phòng trường hợp file A có nhiều chi nhánh)
    df_a[col_ton_a] = pd.to_numeric(df_a[col_ton_a], errors='coerce').fillna(0)
    df_a_grouped = df_a.groupby(col_ten_a, as_index=False)[col_ton_a].sum()
    
    # Tạo từ điển map {Tên hàng: Tổng số lượng tồn}
    mapping_dict = dict(zip(df_a_grouped[col_ten_a], df_a_grouped[col_ton_a]))

    # 4. Ghi đè cột 'Tồn kho' ở file B mà KHÔNG đổi cấu trúc các cột khác
    def get_new_inventory(row):
        ten_sp = row[col_ten_b]
        if ten_sp in mapping_dict:
            return mapping_dict[ten_sp] # Ghi đè dữ liệu mới từ file A
        return row.get('Tồn kho', 0)     # Nếu không tìm thấy, giữ nguyên giá trị cũ ở file B

    df_b['Tồn kho'] = df_b.apply(get_new_inventory, axis=1)
    df_b['Tồn kho'] = df_b['Tồn kho'].astype(int) # Chuyển thành số nguyên

    # 5. Xuất ra file kết quả mới giữ nguyên định dạng cấu trúc của file B
    if output_path.endswith('.csv'):
        df_b.to_csv(output_path, index=False, encoding='utf-8-sig')
    else:
        df_b.to_excel(output_path, index=False)
        
    print(f"🎉 THÀNH CÔNG! Đã xuất file cập nhật tại: {output_path}")

# ==========================================
# CẤU HÌNH ĐƯỜNG DẪN FILE CỦA BẠN TẠI ĐÂY:
# ==========================================
FILE_A = "blank.xlsx"       # Điền tên file chứa cột Tổng tồn (ví dụ: inventory.xlsx)
FILE_B = "inventory.xlsx"       # Điền tên file B cần được cập nhật
FILE_XUAT = "inventory_final.xlsx" # Tên file kết quả sau khi ghi đè

# Kích hoạt chạy hàm
update_inventory(FILE_A, FILE_B, FILE_XUAT)