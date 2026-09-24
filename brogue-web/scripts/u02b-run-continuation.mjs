import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u02b-'));
try {
 await build({entryPoints:['scripts/u02b-continuation.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'probe.mjs'),external:['vitest']});
 await import(pathToFileURL(path.join(temp,'probe.mjs')).href);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
