// Worker của plugin: Orca bật nó ở lần plugin.request đầu tiên của panel. Mỗi lần panel hỏi
// machines.stats, worker SSH song song vào mọi máy trong setting hosts và trả số liệu về.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { OrcaWorkerApi } from 'orca/worker'
import { parseHosts, parseStats, REMOTE_SCRIPT } from './parse'
import type { Machine } from './protocol'

const SSH_TIMEOUT_MS = 20_000

/**
 * Chương trình ssh sẽ gọi. Trên Windows, ssh.exe của OpenSSH đi kèm Windows thoát mã 255 ngay khi
 * chạy trong worker của Orca (kể cả `ssh -V`, thử ngày 16/11/2026), còn ssh của Git for Windows chạy
 * được, nên ưu tiên ssh của Git. Setting sshCommand ghi đè cả hai.
 */
function sshProgram(override: string): string {
  if (override.trim()) return override.trim()
  const gitSsh = ['C:/Program Files/Git/usr/bin/ssh.exe', 'C:/Program Files (x86)/Git/usr/bin/ssh.exe']
  return gitSsh.find((p) => existsSync(p)) ?? 'ssh'
}

/** Chạy REMOTE_SCRIPT trên máy đích. Script đi qua stdin nên không phải lo quote ở shell nào. */
function runRemote(ssh: string, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ssh,
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', target, 'sh', '-s'],
      { windowsHide: true }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Quá ${SSH_TIMEOUT_MS / 1000} giây không xong.`))
    }, SSH_TIMEOUT_MS)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim().split(/\r?\n/).pop() || `ssh thoát với mã ${code}.`))
    })
    child.stdin.end(REMOTE_SCRIPT)
  })
}

async function stats(ssh: string, name: string, target: string): Promise<Machine> {
  try {
    return parseStats(name, target, await runRemote(ssh, target), Date.now())
  } catch (e) {
    return { name, target, ok: false, error: e instanceof Error ? e.message : String(e), at: Date.now() }
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('machines.stats', async () => {
    const text = String((await orca.settings.get('hosts')) ?? '')
    const hosts = parseHosts(text)
    const interval = Number(await orca.settings.get('intervalSeconds')) || 30
    const ssh = sshProgram(String((await orca.settings.get('sshCommand')) ?? ''))
    const machines = await Promise.all(hosts.map((h) => stats(ssh, h.name, h.target)))
    return { machines, intervalSeconds: interval, hosts: text }
  })

  orca.panels.handle('machines.setHosts', async ({ hosts }) => {
    await orca.settings.set('hosts', hosts)
    return { ok: true as const }
  })
}
