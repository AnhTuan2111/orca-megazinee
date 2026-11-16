// Khai báo tối thiểu cho phần node:child_process mà worker dùng, để `tsc` kiểm tra được mà không
// phải cài @types/node vào plugin (plugin không có node_modules).
declare module 'node:child_process' {
  interface Stream {
    on(event: 'data', listener: (chunk: string) => void): void
  }
  interface ChildProcess {
    stdout: Stream
    stderr: Stream
    stdin: { end(data: string): void }
    kill(): boolean
    on(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: (code: number | null) => void): void
  }
  export function spawn(command: string, args: string[], options?: { windowsHide?: boolean }): ChildProcess
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
}
