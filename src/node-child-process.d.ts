// Minimal declarations for the parts of node:child_process the worker uses, so `tsc` can check it without
// installing @types/node (the plugin has no node_modules).
declare module 'node:child_process' {
  interface Stream {
    on(event: 'data', listener: (chunk: string) => void): void
    setEncoding(encoding: 'utf8'): void
  }
  export interface ChildProcess {
    stdout: Stream
    stderr: Stream
    stdin: { end(data: string): void; on(event: 'error', listener: (error: Error) => void): void }
    kill(): boolean
    on(event: 'error', listener: (error: Error) => void): void
    on(event: 'close', listener: (code: number | null) => void): void
  }
  export function spawn(
    command: string,
    args: string[],
    options?: { windowsHide?: boolean; env?: Record<string, string | undefined> }
  ): ChildProcess
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean
}

declare module 'node:os' {
  export function homedir(): string
}

declare const process: { env: Record<string, string | undefined>; platform: string }
