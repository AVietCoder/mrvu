// Cách tính tiền của MỘT phiếu thu/chi lên quỹ — dùng chung cho Sổ quỹ và Báo cáo ngày.
//
// Phiếu kiểu mới ghi Bên A → Bên B (from_kind/from_id → to_kind/to_id):
//   • phiếu THU: Bên A (chi nhánh) nhận tiền (+), Bên B (chi nhánh) mất tiền (−)
//   • phiếu CHI: Bên A (chi nhánh) mất tiền (−), Bên B (chi nhánh) nhận tiền (+)
// Phiếu kiểu cũ chỉ có branch_id: thu (+) / chi (−) cho chi nhánh đó.

const num = (x: any) => Number(x) || 0;

/** Các chi nhánh mà phiếu chạm tới (không trùng lặp). */
export function voucherBranchIds(v: any): string[] {
  if (!v.from_kind && !v.to_kind) return v.branch_id ? [v.branch_id] : [];
  const ids: string[] = [];
  if (v.from_kind === "branch" && v.from_id) ids.push(v.from_id);
  if (v.to_kind === "branch" && v.to_id && !ids.includes(v.to_id)) ids.push(v.to_id);
  return ids;
}

/** Số tiền phiếu làm quỹ của MỘT chi nhánh tăng (+) / giảm (−). */
export function branchDelta(v: any, bId: string): number {
  const amt = num(v.amount);
  const isThu = v.type === "thu";
  if (!v.from_kind && !v.to_kind) {
    if (v.branch_id === bId) return isThu ? amt : -amt;
    return 0;
  }
  let d = 0;
  if (v.from_kind === "branch" && v.from_id === bId) d += isThu ? amt : -amt;
  if (v.to_kind === "branch" && v.to_id === bId) d += isThu ? -amt : amt;
  return d;
}

/**
 * Số tiền phiếu làm quỹ của TOÀN CÔNG TY tăng / giảm = tổng tác động lên mọi chi nhánh.
 * → Chuyển tiền giữa hai chi nhánh (A và B đều là chi nhánh) = 0: tiền chỉ đổi chỗ, không thêm/bớt.
 * → Phiếu không gắn chi nhánh nào: tính theo loại phiếu (thu +, chi −) để không bị mất khỏi tổng.
 * Nhờ vậy "Tất cả" LUÔN bằng tổng các chi nhánh cộng lại (+ phiếu không gắn chi nhánh).
 */
export function systemDelta(v: any): number {
  const ids = voucherBranchIds(v);
  if (!ids.length) return v.type === "thu" ? num(v.amount) : -num(v.amount);
  return ids.reduce((s, id) => s + branchDelta(v, id), 0);
}
