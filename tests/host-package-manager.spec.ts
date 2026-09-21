/**
 * The package manager a packaged host publishes (#653).
 *
 * The reported machine has node only on a shell's PATH: the host was started
 * from a GUI, so `pnpm` is found but cannot run (`env: node: No such file or
 * directory`). The host ships its own runtime and names it through
 * `profileContext.packageManager`, so that invocation is tried before PATH —
 * and when it is absent, nothing about the old chain changes.
 *
 * Only the OS process boundary is mocked; the real callers, shim and
 * environment composition are exercised.
 */

import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcess = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: childProcess.spawn }))

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    pid: 651, stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(),
  })
}

const hostCommand = '/Applications/DSH.app/Contents/Resources/runtime/node'
const hostArgs = ['/Applications/DSH.app/Contents/Resources/runtime/pnpm.mjs']
const hostEnv = { PATH: '/Applications/DSH.app/Contents/Resources/runtime', DSH_BUNDLED: '1' }
const separator = process.platform === 'win32' ? ';' : ':'

let children: ReturnType<typeof fakeChild>[]
let home: string

/** Resolve the nth spawn (the callers may await before spawning) and exit it. */
async function exit(index: number, code: number): Promise<void> {
  await vi.waitFor(() => { expect(children.length).toBeGreaterThan(index) })
  children[index]!.emit('close', code)
  await new Promise(resolve => setImmediate(resolve))
}

function spawnEnvOf(index: number): Record<string, string> {
  return childProcess.spawn.mock.calls[index]![2].env
}

beforeEach(() => {
  vi.resetModules()
  childProcess.spawn.mockReset()
  children = []
  childProcess.spawn.mockImplementation(() => {
    const child = fakeChild()
    children.push(child)
    return child
  })
  home = mkdtempSync(join(tmpdir(), 'dsh-market-host-pm-'))
  vi.stubEnv('DSH_HOME', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  rmSync(home, { recursive: true, force: true })
})

const published = { command: hostCommand, args: hostArgs, env: hostEnv }

describe('probing a host-supplied package manager (#653)', () => {
  it('runs the host invocation with its own args and environment', async () => {
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)

    const probed = module.probePnpm()
    await exit(0, 0)

    await expect(probed).resolves.toBe(true)
    const [file, args] = childProcess.spawn.mock.calls[0]!
    expect([file, args]).toEqual([hostCommand, [...hostArgs, '--version']])
    // The invocation's environment has to arrive whole: the host exports the
    // PATH its bundled node lives in, and that is the only reason the spawn
    // can work at all. Our own settings survive on top of it.
    expect(spawnEnvOf(0).DSH_BUNDLED).toBe('1')
    expect(spawnEnvOf(0).CI).toBe('true')
    expect(spawnEnvOf(0).PATH.split(separator)[0]).toBe(hostEnv.PATH)
    expect(spawnEnvOf(0).PATH).toContain(process.env.PATH ?? '\u0000')
  })

  it('keeps the PATH fallback for a host invocation that will not run', async () => {
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)

    const probed = module.probePnpm()
    await exit(0, 1)
    await exit(1, 0)

    await expect(probed).resolves.toBe(true)
    expect(childProcess.spawn.mock.calls[1]![0]).toBe('pnpm')
  })

  it('is exactly the old probe when the host publishes nothing', async () => {
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)
    module.setHostPackageManager(null)

    const probed = module.probePnpm()
    await exit(0, 0)

    await expect(probed).resolves.toBe(true)
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    expect(childProcess.spawn.mock.calls[0]![0]).toBe('pnpm')
  })
})

describe('one-click setup with a host-supplied package manager (#653)', () => {
  it('provisions nothing and reports the host tool that already works', async () => {
    // corepack and npm are both unreachable on the reported machine — that is
    // why the host bundles a runtime. Asking them to install another pnpm
    // can only fail, so it is not asked.
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)

    const provisioned = module.provisionPnpm()
    await exit(0, 0)

    await expect(provisioned).resolves.toEqual({ ok: true })
    expect(childProcess.spawn).toHaveBeenCalledTimes(1)
    expect(childProcess.spawn.mock.calls[0]![0]).toBe(hostCommand)
  })

  it('names the host invocation instead of sending the user to PNPM_HOME', async () => {
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)

    const provisioned = module.provisionPnpm()
    await exit(0, 1)
    await exit(1, 1)

    const result = await provisioned
    expect(result.ok).toBe(false)
    expect(result.hint).toContain(hostCommand)
    // Every PATH-shaped explanation is advice for a problem this user does
    // not have: their pnpm never entered the picture.
    expect(result.hint).not.toContain('找不到 npm/corepack')
  })
})

describe('the hint for a pnpm that exists but cannot start (#653)', () => {
  it('reads the raw output and explains the missing interpreter', async () => {
    const { provisionHint } = await import('../src/dsh-cli.ts')

    // Verbatim from the report: pnpm's own output when `env` finds no node.
    const hint = provisionHint('', 'changed 1 package in 491ms', true, {
      kind: 'failed', output: 'env: node: No such file or directory',
    })

    expect(hint).toContain('env: node: No such file or directory')
    expect(hint).toContain('#!/usr/bin/env node')
    // Neither the shim's network nor PNPM_HOME is the problem here.
    expect(hint).not.toContain('需要联网下载 pnpm 本体')
  })

  it('keeps the corepack explanation for output that is not that', async () => {
    const { provisionHint } = await import('../src/dsh-cli.ts')

    const hint = provisionHint('', 'changed 1 package in 491ms', true, {
      kind: 'failed', output: 'Error: getaddrinfo ENOTFOUND registry.npmjs.org',
    })

    expect(hint).toContain('需要联网下载 pnpm 本体')
  })
})

describe('the host environment reaches an install (#653)', () => {
  it('forwards it to the plugin command the market runs', async () => {
    const module = await import('../src/dsh-cli.ts')
    module.setHostPackageManager(published)

    const install = module.runDshPlugin('web', ['add', '@scope/plugin'])
    await exit(0, 0)

    await expect(install).resolves.toMatchObject({ exitCode: 0 })
    expect(spawnEnvOf(0).DSH_BUNDLED).toBe('1')
    expect(spawnEnvOf(0).PATH.split(separator)[0]).toBe(hostEnv.PATH)
  })
})
