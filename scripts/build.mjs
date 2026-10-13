import { build } from 'vite';
import { config } from './vite.mjs';
import { writeAppRevision } from './app-revision.mjs';
await build(config);
await writeAppRevision();
