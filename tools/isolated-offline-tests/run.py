from pathlib import Path
import subprocess,os,re,sys,tempfile
root=Path(sys.argv[1]);scratch=Path(__file__).parent;logs=Path(tempfile.mkdtemp(prefix='lsa-offline-tests-'));passed=failed=0;bad=[]
for file in sorted((root/'tests').glob('*.test.mjs')):
 env=dict(os.environ,LSA_OFFLINE_TEST_FILE=file.as_uri());result=subprocess.run(['node','--test','--test-reporter=tap',str(scratch/'wrapper.mjs')],cwd=root,env=env,capture_output=True,text=True,encoding='utf-8')
 (logs/(file.stem+'.log')).write_text(result.stdout+result.stderr,encoding='utf-8')
 counts=re.findall(r'^# tests (\d+)$',result.stdout,re.M);count=int(counts[-1]) if counts else 0
 if result.returncode:
  bad.append(file.name);failed+=count;print('FAIL '+file.name+' exit='+str(result.returncode),flush=True)
  if os.environ.get('LSA_CI_FAILURE_DETAILS')=='1':
   output=(result.stdout+result.stderr).splitlines()
   detail=[line.strip() for line in output if re.search(r'^(?:not ok \\d+|\\s*(?:error:|code:|failureType:|stack:|\\d+\\)|# Error|# .*ERR_|# .*assert|# .*undefined))',line)]
   for line in (detail[:24] or output[-14:]):print('  '+line[:280],flush=True)
 else:passed+=count
print(f'Completed {len(list((root/"tests").glob("*.test.mjs")))} files; passed-test count {passed}; failed files {bad}',flush=True)
sys.exit(bool(bad))
