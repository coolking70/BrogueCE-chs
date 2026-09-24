import {build}from'esbuild';import{execFileSync}from'node:child_process';
await build({entryPoints:['scripts/u02b-isolation-evidence.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/u02b-isolation.mjs',logLevel:'silent'});
console.log(execFileSync('node',['/tmp/u02b-isolation.mjs'],{encoding:'utf8',maxBuffer:16*1024*1024}));
