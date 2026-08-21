/**
 * Voice-input plugin, node half. Pure browser surface: the empty apply exists
 * so the plugin appears in the host roster; the browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. Speech recognition is the browser's own Web Speech API — no
 * host-side behavior.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
