/** Package invariant companion for the meeting runtime. @module @deepseek-ai/dsh-meeting-runtime/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-meeting-runtime'
export const name = 'meeting-runtime-invariant'
export const inject = ['invariants']
/** No runtime invariant: route and subprocess ownership are effect-managed and covered by composition tests. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
