from pathlib import Path
import subprocess,os,re,sys,tempfile
root=Path(sys.argv[1]);scratch=Path(__file__).parent;logs=Path(tempfile.mkdtemp(prefix='lsa-offline-tests-'));passed=failed=0;bad=[]
for file in sorted((root/'tests').glob('*.test.mjs')):
 env=dict(os.environ,LSA_OFFLINE_TEST_FILE=file.as_uri())
 scenario=re.fullmatch(r'memory-k-original-(S[0-9]{2})\.test\.mjs',file.name)
 with tempfile.TemporaryDirectory(prefix='lsa-original-scenario-') as scenario_dir:
  if scenario:
   head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
   env.update(MEMORY_K_W09_DB_PATH=str(Path(scenario_dir)/'evidence.sqlite'),
    MEMORY_K_EXPECTED_HEAD_SHA=head,MEMORY_K_EXPECTED_SCENARIO=scenario[1])
  result=subprocess.run(['node','--test','--test-reporter=tap',str(scratch/'wrapper.mjs')],cwd=root,env=env,capture_output=True,text=True,encoding='utf-8')
 (logs/(file.stem+'.log')).write_text(result.stdout+result.stderr,encoding='utf-8')
 counts=re.findall(r'^# tests (\d+)$',result.stdout,re.M);count=int(counts[-1]) if counts else 0
 if result.returncode:
  bad.append(file.name);failed+=count;print('FAIL '+file.name+' exit='+str(result.returncode),flush=True)
  if os.environ.get('LSA_CI_FAILURE_DETAILS')=='1':
   output=(result.stdout+result.stderr).splitlines()
   detail=[line.strip() for line in output if any(token in line for token in ('not ok ','error:','code:','failureType:','stack:','# Error'))]
   for line in (output[:150] if 'radio' in file.name or file.name in ('observability.test.mjs','openai-transport.test.mjs','salience-engine.test.mjs','perception-contract.test.mjs','perception-witness-rules.test.mjs') else (detail[:24] or output[-14:])):print('  '+line[:380],flush=True)
 else:passed+=count
print(f'Completed {len(list((root/"tests").glob("*.test.mjs")))} files; passed-test count {passed}; failed files {bad}',flush=True)
print(f'Logs: {logs}',flush=True)
sys.exit(bool(bad))
