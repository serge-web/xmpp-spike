// CLI: SERVER=<name> npx tsx spike/provision.ts [teardown]
import { adapterFor } from './tests/provision/index.js';

const adapter = await adapterFor();
if (process.argv[2] === 'teardown') await adapter.teardown();
else await adapter.provision();
console.log('done');
