/** Package invariant companion for the stateless meeting prompt consumer. @module @deepseek-ai/dsh-meeting-prompt/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-meeting-prompt'

/** Cordis companion plugin name. */
export const name = 'meeting-prompt-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: prompt registration is effect-owned by dsh-system-prompt. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - context carrying the invariant service. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
