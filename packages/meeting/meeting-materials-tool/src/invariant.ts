/** Package invariant companion for the stateless meeting materials tool. @module @deepseek-ai/dsh-meeting-materials-tool/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-meeting-materials-tool'

/** Cordis companion plugin name. */
export const name = 'meeting-materials-tool-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** No runtime invariant: the tool registry owns registration and execution lifecycle. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. @param ctx - context carrying the invariant service. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
