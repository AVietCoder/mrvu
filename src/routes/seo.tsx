// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/context/AuthContext";

/**
 * SEO Studio nhúng trong POS (chỉ admin). Công cụ chạy ở /seo-studio/ (HTTP route riêng,
 * có đăng nhập Google của riêng nó); trang này chỉ là khung chứa.
 * ?p=<đường dẫn trong /seo-studio/> để mở đúng tab (dùng khi quay về từ trang đăng nhập Google).
 */
export const Route = createFileRoute("/seo")({
  head: () => ({ meta: [{ title: "SEO Studio — Mr.Vũ" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ p: typeof s.p === "string" ? s.p : undefined }),
  component: Page,
});

function innerSrc(p?: string) {
  // Chỉ nhận đường dẫn nội bộ của SEO Studio (chống chuyển hướng ra ngoài).
  if (p && p.startsWith("/seo-studio/") && !p.startsWith("//") && !p.includes("\\")) return p;
  return "/seo-studio/";
}

function Page() {
  const { isAdmin } = useAuth();
  const { p } = Route.useSearch();

  if (!isAdmin) {
    return (
      <AppShell title="SEO Studio">
        <div className="flex flex-col items-center justify-center h-60 gap-3 text-muted-foreground">
          <Search className="h-12 w-12 opacity-30" />
          <p>Bạn không có quyền xem trang này.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="SEO Studio">
      {/* Bỏ phần đệm của AppShell để khung chiếm trọn vùng nội dung (header cao ~57px). */}
      <div className="-m-4 md:-m-6">
        <iframe
          title="SEO Studio"
          src={innerSrc(p)}
          className="block w-full border-0 h-[calc(100dvh-57px)]"
        />
      </div>
    </AppShell>
  );
}
