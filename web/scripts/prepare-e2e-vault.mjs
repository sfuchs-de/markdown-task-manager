import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(webRoot);
const destination = path.join(webRoot, '.tmp', 'e2e-vault');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'example-vault'), destination, { recursive: true });
console.log(`Prepared fictional E2E vault at ${destination}`);
