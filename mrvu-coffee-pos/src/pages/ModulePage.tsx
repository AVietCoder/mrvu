import { useLocation } from 'react-router-dom'
import { Hammer } from 'lucide-react'
import { MODULES } from '@/app/modules'

/** Khung tạm cho module chưa xây dựng. Hiển thị trung thực giai đoạn dự kiến. */
export default function ModulePage() {
  const { pathname } = useLocation()
  const mod = MODULES.find((m) => m.path === pathname)
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <Hammer className="mx-auto text-neutral-400" />
      <h1 className="mt-3 text-lg font-bold">{mod?.label ?? 'Module'}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Chức năng này chưa được xây dựng. Dự kiến triển khai ở Giai đoạn {mod?.phase}.
      </p>
    </div>
  )
}
