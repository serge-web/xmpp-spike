// Vitest global setup: provision the §4 fixture before any check runs. Fails (never skips) if unreachable.
import { adapterFor } from './provision/index.js';

export default async function setup(): Promise<void> {
  await (await adapterFor()).provision();
}
