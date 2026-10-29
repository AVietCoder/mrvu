export default function ConfigMissingPage() {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="card max-w-lg p-6">
        <h1 className="text-xl font-bold">Chưa cấu hình Supabase</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Tạo tệp <code className="rounded bg-neutral-100 px-1">.env</code> từ <code className="rounded bg-neutral-100 px-1">.env.example</code>{' '}
          và điền hai giá trị sau, rồi khởi động lại ứng dụng:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100">
{`VITE_CAFE_SUPABASE_URL=https://xxxx.supabase.co
VITE_CAFE_SUPABASE_ANON_KEY=<anon key>`}
        </pre>
        <p className="mt-3 text-sm text-neutral-600">
          Chỉ dùng <b>anon key</b>. Không bao giờ đặt service role key vào ứng dụng.
        </p>
      </div>
    </div>
  )
}
