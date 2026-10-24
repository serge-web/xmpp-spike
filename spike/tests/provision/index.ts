import { serverConfig } from '../config.js';
import type { ProvisioningAdapter } from './adapter.js';

export async function adapterFor(): Promise<ProvisioningAdapter> {
  const name = serverConfig().name;
  return (await import(`./${name}.js`)).default as ProvisioningAdapter;
}
