/**
 * Dựng `template_data` gửi cho Zalo từ cấu hình template đã lưu.
 *
 * Bóc ra từ enqueue.ts để tin sinh nhật và tin bảo dưỡng dùng chung đúng một
 * logic — nếu để mỗi nơi tự viết lại thì chỉ cần một chỗ quên cắt theo
 * maxLength là Zalo từ chối cả tin.
 */

export interface ZnsParamSpec {
  name: string;
  require?: boolean;
  maxLength?: number;
}

/** Cắt chuỗi theo maxLength Zalo khai báo — vượt quá là Zalo từ chối cả tin. */
export function clamp(value: string, maxLength?: number): string {
  if (!maxLength || maxLength <= 0) return value;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Gộp nhiều tên sản phẩm vào một biến có giới hạn độ dài.
 *
 * Cắt thô bằng `slice` sẽ làm cụt giữa tên sản phẩm ("Quạt trần Lotus Pl"),
 * nhìn như lỗi hệ thống. Ở đây cắt theo ranh giới từng tên và nói rõ còn bao
 * nhiêu cái nữa.
 */
export function joinClamp(names: string[], maxLength: number, sep = ", "): string {
  const list = names.map((n) => String(n ?? "").trim()).filter(Boolean);
  if (!list.length) return "";

  const full = list.join(sep);
  if (!maxLength || full.length <= maxLength) return full;

  const kept: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const remaining = list.length - (i + 1);
    const suffix = remaining > 0 ? ` và ${remaining} sản phẩm khác` : "";
    const candidate = [...kept, list[i]].join(sep) + suffix;
    if (candidate.length > maxLength) break;
    kept.push(list[i]);
  }

  // Ngay cả tên đầu tiên cũng đã dài quá giới hạn — đành cắt cứng.
  if (!kept.length) return clamp(list[0], maxLength);

  const remaining = list.length - kept.length;
  return kept.join(sep) + (remaining > 0 ? ` và ${remaining} sản phẩm khác` : "");
}

/**
 * Ánh xạ dữ liệu nội bộ sang tên biến của Zalo theo `param_map` đã cấu hình,
 * cắt theo `maxLength` của từng biến, và trả về danh sách biến bắt buộc còn
 * thiếu để nơi gọi dừng lại trước khi tốn một lượt gửi.
 */
export function buildTemplateData(
  tpl: { param_map?: Record<string, string> | null; list_params?: ZnsParamSpec[] | null },
  values: Record<string, string>,
): { templateData: Record<string, string>; missing: string[] } {
  const paramMap = (tpl.param_map ?? {}) as Record<string, string>;
  const listParams = (tpl.list_params ?? []) as ZnsParamSpec[];
  const maxLenByName = new Map(listParams.map((p) => [p.name, p.maxLength]));

  const templateData: Record<string, string> = {};
  for (const [zaloParam, internalKey] of Object.entries(paramMap)) {
    if (!internalKey) continue;
    templateData[zaloParam] = clamp(values[internalKey] ?? "", maxLenByName.get(zaloParam));
  }

  const missing = listParams
    .filter((p) => p.require && !templateData[p.name])
    .map((p) => p.name);

  return { templateData, missing };
}
