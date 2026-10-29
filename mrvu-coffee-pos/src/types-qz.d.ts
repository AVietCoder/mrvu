declare module 'qz-tray' {
  // Khai báo tối thiểu cho phần API QZ Tray mà ứng dụng dùng.
  const qz: {
    websocket: { connect(o?: Record<string, unknown>): Promise<void>; disconnect(): Promise<void>; isActive(): boolean }
    printers: { find(q?: string): Promise<string | string[]>; getDefault(): Promise<string> }
    configs: { create(printer: string, o?: Record<string, unknown>): unknown }
    print(config: unknown, data: unknown[]): Promise<void>
    security: { setCertificatePromise(f: (resolve: (c: string) => void, reject: (e: unknown) => void) => void): void; setSignatureAlgorithm(a: string): void; setSignaturePromise(f: (toSign: string) => (resolve: (s: string) => void, reject: (e: unknown) => void) => void): void }
  }
  export default qz
}
