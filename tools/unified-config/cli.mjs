#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './manager.mjs';

const HELP='Usage: node tools/unified-config/cli.mjs <import|validate|diff|apply|status|rollback> [--game "C:\\path\\Grand Theft Auto V Enhanced"] [--master path] [--activate] [--replace]\nImport reads installed configs without activating. Initial apply requires --activate. Never point this at a live update by another process.\n';
async function findGame(explicit) {
  if(explicit) return path.resolve(explicit);
  if(process.env.LSA_GTA_DIR) return path.resolve(process.env.LSA_GTA_DIR);
  const dirs=new Set();
  if(process.platform==='win32') {
    for(const base of [process.env['ProgramFiles(x86)'],process.env.ProgramFiles,'C:\\Program Files (x86)','C:\\Program Files']) if(base) {
      const steam=path.join(base,'Steam');
      dirs.add(path.join(steam,'steamapps','common','Grand Theft Auto V Enhanced'));
      const libraries=path.join(steam,'steamapps','libraryfolders.vdf');
      try {
        const vdf=await fs.readFile(libraries,'utf8');
        for(const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) dirs.add(path.join(match[1].replace(/\\\\/g,'\\'),'steamapps','common','Grand Theft Auto V Enhanced'));
      } catch(e) {if(e.code!=='ENOENT') throw e;}
    }
  }
  const matches=[];
  for(const dir of dirs) if(await fs.stat(dir).then(s=>s.isDirectory(),()=>false)) matches.push(dir);
  if(matches.length!==1) throw new Error(matches.length?'Multiple GTA installations: specify --game exactly':'GTA installation not found: specify --game');
  return matches[0];
}
async function main(argv) {
  if(argv.length===0||argv.includes('--help')||argv.includes('-h')) {process.stdout.write(HELP);return;}
  const command=argv.shift(),opts={};
  while(argv.length) {
    const flag=argv.shift();
    if(flag==='--game'||flag==='--master') {
      if(!argv.length) throw new Error('Missing value for '+flag);
      opts[flag.slice(2)]=argv.shift();
    } else if(flag==='--activate'||flag==='--replace') opts[flag.slice(2)]=true;
    else throw new Error('Unknown option '+flag);
  }
  if(!['import','validate','diff','apply','status','rollback'].includes(command)) throw new Error('Unknown command '+command);
  if(opts.activate&&command!=='apply') throw new Error('--activate is apply-only');
  if(opts.replace&&command!=='import') throw new Error('--replace is import-only');
  const game=await findGame(opts.game);
  const output=await run(command,{game,masterPath:opts.master,activate:opts.activate,replace:opts.replace});
  process.stdout.write(JSON.stringify({command,game,...output},null,2)+'\n');
  if(output.ok===false) process.exitCode=2;
}
main(process.argv.slice(2)).catch(e=>{console.error('LSA config: '+e.message);process.exitCode=1;});