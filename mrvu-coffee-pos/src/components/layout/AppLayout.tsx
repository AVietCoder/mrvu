import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { LogOut, Menu, X } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '@/app/AuthProvider'
import { MODULES } from '@/app/modules'
import { ROLE_LABEL } from '@/lib/permissions'

export default function AppLayout() {
  const { membership, can, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const items = MODULES.filter((m) => !m.permission || can(m.permission))

  return (
    <div className="flex h-full">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-neutral-900 text-neutral-200 transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div>
            <div className="text-lg font-extrabold leading-none tracking-tight text-white">
              MR.<span className="text-brand-500">VŨ</span> COFFEE
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-widest text-neutral-400">POS</div>
          </div>
          <button className="lg:hidden" aria-label="Đóng menu" onClick={() => setOpen(false)}><X size={20} /></button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {items.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                clsx(
                  'flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-600 text-white' : 'text-neutral-300 hover:bg-neutral-800 hover:text-white',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4">
          <button className="btn-secondary !min-h-[40px] !px-2 lg:hidden" aria-label="Mở menu" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{membership?.store?.name}</div>
            <div className="truncate text-xs text-neutral-500">{membership?.store?.address}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold">{membership?.fullName}</div>
              <div className="text-xs text-neutral-500">{membership?.role ? ROLE_LABEL[membership.role] : ''}</div>
            </div>
            <button className="btn-secondary !min-h-[40px]" onClick={signOut} title="Đăng xuất">
              <LogOut size={16} /> <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
