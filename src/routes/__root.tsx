// @ts-nocheck
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet, Link, createRootRouteWithContext,
  useRouter, HeadContent, Scripts, useNavigate,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { RouterProgressBar } from "@/components/Spinner";
import { useEffect, useState } from "react";
import appCss from "../styles.css?url";
import { getSettings } from "@/lib/settings.functions";
import { useServerFn } from "@tanstack/react-start";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold">404</h1>
        <p className="mt-2 text-muted-foreground">Trang không tồn tại</p>
        <Link to="/" className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Trang không tải được</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button 
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Thử lại
        </button>
      </div>
    </div>
  );
}

function AuthGuard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = router.state.location.pathname;

  const publicPaths = ["/login", "/register"];

  useEffect(() => {
    if (!session && !publicPaths.includes(pathname)) {
      navigate({ to: "/login" });
    }
  }, [session, pathname]);

  return <Outlet />;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const getSettingsFn = useServerFn(getSettings);
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    getSettingsFn().then(setSettings);
  }, []);

  // Dynamic Favicon
  useEffect(() => {
    if (settings?.logo_url) {
      let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/x-icon";
        document.head.appendChild(link);
      }
      link.href = settings.logo_url;
    }
  }, [settings?.logo_url]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProgressBar />
        <AuthGuard />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}