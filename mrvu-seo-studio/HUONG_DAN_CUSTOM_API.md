# Đặc tả "Custom API" để nhận bài từ Mr.Vũ SEO Studio (Autopost)

Tài liệu này dành cho người lập trình website (ASP.NET, PHP, Node…). Website chỉ cần **một địa chỉ nhận bài** (endpoint) theo đặc tả dưới đây.

## Yêu cầu

- Phương thức: `POST`, nội dung `application/json; charset=utf-8`.
- Header xác thực: `Authorization: Bearer <MÃ_BẢO_MẬT>`. Mã do bạn tự đặt, nhập giống hệt vào ô "Mã bảo mật" trong công cụ. Sai mã thì trả `401`.
- Thành công: trả mã `200` hoặc `201` kèm JSON `{"id": "...", "url": "https://..."}`. Trường `url` là đường dẫn bài vừa tạo; công cụ hiển thị nó và dùng làm link nội bộ cho các bài sau.
- Lỗi: trả mã `4xx/5xx` kèm `{"error": "mô tả lỗi"}`. Công cụ ghi nội dung này vào Nhật ký.

## Gói tin kiểm tra kết nối

Khi bấm **Kiểm tra kết nối**, công cụ gửi `{"test": true}`. Hãy kiểm tra mã bảo mật rồi trả `200 {"ok": true}`, **không tạo bài**.

## Gói tin bài viết

```json
{
  "title": "Cách chọn quạt trần phòng khách đẹp, mát và tiết kiệm điện",
  "slug": "cach-chon-quat-tran-phong-khach",
  "content_html": "<p>…</p><h2>…</h2>…",
  "excerpt": "Tóm tắt 1–2 câu",
  "meta_title": "Cách Chọn Quạt Trần Phòng Khách Chuẩn, Mát, Tiết Kiệm Điện",
  "meta_description": "120–160 ký tự…",
  "keyword": "cách chọn quạt trần phòng khách",
  "tags": ["quạt trần", "phòng khách"],
  "category": "Tin tức",
  "status": "draft",
  "images": [
    {"filename": "quat-tran-phong-khach.jpg", "mime": "image/jpeg", "alt": "Quạt trần phòng khách hiện đại",
     "credit": "", "base64": "/9j/4AAQSkZJRgABAQ…"}
  ]
}
```

| Trường | Ý nghĩa |
|---|---|
| `title` | Tiêu đề bài, hiển thị làm thẻ **H1** |
| `content_html` | Thân bài HTML đã làm sạch (chỉ p, h2, h3, ul, ol, li, strong, em, a, table, blockquote, figure, img). **Không có H1**, website tự in `title` làm H1 |
| `meta_title`, `meta_description` | Đặt vào `<title>` và `<meta name="description">` của trang bài |
| `slug` | Đường dẫn không dấu. Nếu trùng bài đã có, thêm hậu tố `-2`, `-3`… |
| `status` | `draft` = lưu nháp chờ duyệt, `publish` = hiển thị ngay |
| `images` | Ảnh dạng base64. Ảnh đầu tiên dùng làm **ảnh đại diện**; các ảnh sau chèn vào bài (ví dụ sau thẻ `</h2>` thứ 1, 3, 5) bằng `<figure><img src="…" alt="…"></figure>` |

## Ví dụ ASP.NET (Generic Handler `.ashx`, C#)

```csharp
public class NhanBai : IHttpHandler {
    const string TOKEN = "doi-thanh-chuoi-bi-mat-dai";
    public void ProcessRequest(HttpContext ctx) {
        ctx.Response.ContentType = "application/json; charset=utf-8";
        if (ctx.Request.Headers["Authorization"] != "Bearer " + TOKEN) {
            ctx.Response.StatusCode = 401; ctx.Response.Write("{\"error\":\"Sai mã bảo mật\"}"); return;
        }
        string body = new StreamReader(ctx.Request.InputStream, Encoding.UTF8).ReadToEnd();
        dynamic d = Newtonsoft.Json.JsonConvert.DeserializeObject(body);
        if (d.test == true) { ctx.Response.Write("{\"ok\":true}"); return; }

        // 1. Lưu ảnh: File.WriteAllBytes(Server.MapPath("~/uploads/" + ten), Convert.FromBase64String((string)img.base64))
        // 2. Chèn ảnh vào content_html, lưu bài vào CSDL (title, slug, content, meta_title, meta_description, status…)
        // 3. Trả về id và url của bài
        int id = /* id bài vừa lưu */ 0;
        string url = "https://mrvu.vn/tin-tuc/" + (string)d.slug + ".aspx";
        ctx.Response.Write("{\"id\":" + id + ",\"url\":\"" + url + "\"}");
    }
    public bool IsReusable => false;
}
```

Lưu ý bảo mật: chỉ chấp nhận HTTPS, dùng mã bảo mật dài và ngẫu nhiên, giới hạn kích thước request (ảnh base64 có thể vài MB), và kiểm tra lại HTML trước khi lưu dù công cụ đã làm sạch.
