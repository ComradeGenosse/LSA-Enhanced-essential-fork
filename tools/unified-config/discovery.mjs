import path from 'node:path';

// Pure selection seam: caller discovers existing Steam libraries; this refuses ambiguity.
export function chooseGameDirectory(directories) {
  const unique=new Map();
  for(const directory of directories) {
    if(typeof directory!=='string'||!directory.trim()) continue;
    const resolved=path.resolve(directory);
    unique.set(process.platform==='win32'?resolved.toLowerCase():resolved,resolved);
  }
  if(unique.size!==1) throw new Error(unique.size?'Multiple GTA installations: specify --game exactly':'GTA installation not found: specify --game');
  return [...unique.values()][0];
}
