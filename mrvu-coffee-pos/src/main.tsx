import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@/app/App'
import { AuthProvider } from '@/app/AuthProvider'
import { PrintProvider } from '@/services/print/PrintProvider'
import { ToastProvider } from '@/components/ui/Toast'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

// HashRouter để chạy được cả trong Electron (tải từ file://) lẫn khi deploy web.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <ToastProvider>
          <AuthProvider>
            <PrintProvider>
              <App />
            </PrintProvider>
          </AuthProvider>
        </ToastProvider>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
)
