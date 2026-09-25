/**
 * Host ui-primitives the market uses WHEN THE RUNNING HOST HAS THEM.
 *
 * The primitives module is injected by the host, so the set of components
 * available at render time is whatever that host ships — 0.1.0-rc.7 has 25
 * export groups, 0.1.7-rc.2 has 51. A component the host has should be used
 * rather than re-implemented: the market sits inside the host's settings page,
 * and a hand-rolled lookalike drifts from it the moment either side changes.
 *
 * Anything resolved here MUST have a fallback at its call site, and the
 * fallback is the market's own markup — that is the whole difference between
 * this and `REQUIRED_PRIMITIVES` (src/client/index.ts), which decides whether
 * the market can render at all. Same rule as the icon aliases
 * (src/client/icons.ts): a host that predates a component costs that one
 * component's upgrade, never the page.
 *
 * `null` means "this host does not have it", which is the ordinary case on the
 * 0.1.x hosts the market still supports — so a call site that forgets its
 * fallback fails loudly in tests (which run against an old host's 0.1.0-rc.7)
 * rather than silently in production.
 */
import type { ReactNode } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** The palette `Tag` accepts (0.1.7-rc.2+). */
export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'

export type TagComponent = (props: { tone?: TagTone; className?: string; children?: ReactNode }) => ReactNode

function optionalComponent<T>(name: string): T | null {
  const value = (primitives as unknown as Record<string, unknown>)[name]
  // React components are functions, or objects tagged with $$typeof (memo /
  // forwardRef wrappers). Anything else — undefined on an older host, a string
  // from a bad shim — is not a component and must not be rendered as one.
  if (typeof value === 'function') return value as T
  if (value !== null && typeof value === 'object' && '$$typeof' in (value as object)) return value as T
  return null
}

/**
 * `Tag` — the host's read-only chip, for facts with no status meaning
 * (capabilities, categories). Null on hosts older than 0.1.7-rc.2.
 */
export const HostTag: TagComponent | null = optionalComponent<TagComponent>('Tag')
