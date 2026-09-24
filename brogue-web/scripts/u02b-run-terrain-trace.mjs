import{build}from'esbuild';import{execFileSync}from'node:child_process';
await build({entryPoints:['scripts/u02b-terrain-trace.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/u02b-terrain-trace.mjs',logLevel:'silent'});execFileSync('node',['/tmp/u02b-terrain-trace.mjs'],{stdio:'ignore'});
