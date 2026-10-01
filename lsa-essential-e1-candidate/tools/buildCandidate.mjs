import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNativeContract } from './verifyNativeContract.mjs';
import { assertCandidateWriteTarget, assertNoLinkedOutput, candidateRootPath } from './checkIsolation.mjs';

const root = candidateRootPath();
const require = createRequire(import.meta.url);
const acorn = require('./vendor/acorn');
const expectedBundleHash = '5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2';
const expectedDllHash = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
const expectedNativeMetadataHash = '18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23';
const launcherName = 'server.bundle.mjs';
const stockBundleDefault = path.resolve(root, 'upstream/server.bundle.mjs');
const stockDllDefault = path.resolve(root, 'upstream/LosSantosAlive.dll');

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
async function fileHash(file) { return digest(await readFile(file)); }
function children(node) {
  const found = [];
  for (const [key, value] of Object.entries(node || {})) {
    if (['start', 'end', 'loc', 'range', 'comments', 'tokens'].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item?.type) found.push(item);
    } else if (value?.type) found.push(value);
  }
  return found;
}
function walk(node, visit) {
  if (!node?.type) return;
  visit(node);
  for (const child of children(node)) walk(child, visit);
}
function one(nodes, label) {
  if (nodes.length !== 1) throw new Error(`${label}: expected one exact AST match; found ${nodes.length}.`);
  return nodes[0];
}
function functions(ast, name) {
  return ast.body.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === name);
}
function functionBody(ast, name) { return one(functions(ast, name), `function ${name}`).body; }
function memberName(node) {
  return node?.type === 'MemberExpression' && !node.computed ? node.property.name : null;
}
function isIdentifier(node, name) { return node?.type === 'Identifier' && node.name === name; }

export function patchSource(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  const edits = [];
  const insert = (position, text, label) => edits.push({ start: position, end: position, text, label });
  const replace = (start, end, text, label) => edits.push({ start, end, text, label });
  const prelude = (name, text) => {
    const body = functionBody(ast, name);
    insert(body.start + 1, text, `${name} body hook`);
  };

  insert(0, `const __LSA_E1_BOOT = await import("./e1/bootstrap.mjs");\nconst __LSA_E1_RUNTIME = await __LSA_E1_BOOT.createRuntimeForBundle();\n`, 'runtime import');

  const kKDeclarator = one(ast.body.flatMap(statement => statement.type === 'VariableDeclaration' ? statement.declarations : []).filter(item => item.id?.name === 'kK'), 'transport factory kK');
  if (kKDeclarator.init?.type !== 'ArrowFunctionExpression') throw new Error('kK factory no longer uses an arrow function.');
  replace(kKDeclarator.init.start, kKDeclarator.init.end, '() => __LSA_E1_RUNTIME.createTransport(() => new dd)', 'provider transport factory');

  const kKStatement = ast.body.find(statement => statement.type === 'VariableDeclaration' && statement.declarations.includes(kKDeclarator));
  if (!kKStatement) throw new Error('kK declaration statement missing.');
  insert(kKStatement.end, `\nglobalThis.__LSA_E1_RUNTIME = __LSA_E1_RUNTIME;\n__LSA_E1_RUNTIME.attachBridge({\n` +
    `  isCurrent(identity) { const turn = le.getTurn(identity.turnId); const session = A.sessionsByPedId.get(identity.pedId); return !!turn && !Vt(turn.status) && turn.metadata?.provider === "openai" && turn.metadata?.sessionNonce === identity.sessionNonce && turn.pedId === identity.pedId && turn.generationId === identity.generationId && le.isCurrentGeneration(turn) && iP(identity.pedId) === identity.sessionNonce && session?.provider === "openai" && session.nonce === identity.sessionNonce; },\n` +
    `  validateDecision(decision, context, identity) { if (!this.isCurrent(identity)) return { identityValid: false }; const actor = A.sessionsByPedId.get(identity.pedId)?.actorContext || context.actor || {}; const allowedActionNames = new Set(ra(actor).map(item => h4(String(item.tag || "").split(/[\\s<]/, 1)[0])).filter(Boolean)); return __LSA_E1_RUNTIME.validateStockDecision(decision, { identity, actor, allowedActionNames, parseActions: Cb, resolvePerson: reference => reference === "A" || !!Ab(reference, identity.pedId), resolveVehicle: reference => !!g4(reference, identity.pedId) }); },\n` +
    `  async routePinnedEvent(event) { if (!this.isCurrent(event) || event.provider !== "openai") return false; this.assertCapabilities(); const nativeTurn = le.getTurn(event.turnId); const metrics = nativeTurn && __LSA_E1_RUNTIME.telemetry?.beginTurn({ pedId: nativeTurn.pedId, turnId: nativeTurn.id, generationId: nativeTurn.generationId, sessionNonce: nativeTurn.metadata.sessionNonce }, nativeTurn.source || "player_text"); const actionRoute = event.type === Ee.OUTPUT_TRANSCRIPT && metrics?.hasAction; if (actionRoute) metrics.actionDispatchStart(); try { const routed = await AP(event); if (actionRoute) metrics.actionDispatchEnd(routed === true); return routed; } catch (error) { if (actionRoute) metrics.actionDispatchEnd(false); throw error; } },\n` +
    `  authorize(identity) { if (!this.isCurrent(identity)) return false; this.assertCapabilities(); const turn = le.getTurn(identity.turnId); RP(turn); return true; },\n` +
    `  assertCapabilities() { const endpoint = A.audioEndpoint; if (!endpoint?.connected || !endpoint.ready || endpoint.protocolVersion !== 3 || !endpoint.supportsTurnIdentity || !endpoint.supportsStreamEnded || !endpoint.supportsExactInterrupt || !endpoint.supportsPlaybackStarted || !endpoint.supportsStaleGenerationRejection) throw new Error("E1 requires the Hotfix 3 tagged playback contract."); },\n` +
    `  onNativeEvent(listener) { return xn(event => { const turn = event?.turn; if (turn?.metadata?.provider !== "openai") return; if (iP(turn.pedId) !== turn.metadata.sessionNonce) return; const msg = event.message || {}; listener({ type: event.type, pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce, reason: String(msg.reason || event.reason || ""), wasInterrupted: msg.wasInterrupted === true, hadAudio: msg.hadAudio === true, playbackStarted: msg.playbackStarted === true }); }); },\n` +
    `  failMatchingTurn(identity, error) { const turn = le.getTurn(identity.turnId); if (!turn || Vt(turn.status) || turn.pedId !== identity.pedId || turn.metadata?.provider !== "openai" || turn.metadata?.sessionNonce !== identity.sessionNonce || turn.generationId !== identity.generationId) return false; const attempted = Number(turn.output?.audioChunkCount || 0) > 0 || turn.audio?.playbackStarted === true; Zt(turn.id, attempted ? ke.PLAYBACK_ERROR : ke.GEMINI_ERROR, error); return true; },\n` +
    `  log(identity, event, details = {}) { se("E1", event, { pedId: identity.pedId, turnId: identity.turnId, generationId: identity.generationId, sessionNonce: identity.sessionNonce, provider: "openai", source: details.source, terminalReason: details.reason, stage: details.stage, cause: details.cause }); },\n` +
    `});\n`, 'Essential provider/action/playback bridge');

  // The adapter receives the current player/actor snapshot along with the stock prompt.
  const wpBody = functionBody(ast, 'WP');
  const connectCall = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'CallExpression' && memberName(node.callee) === 'connect') all.push(node); }); return all; })(), 'WP transport.connect');
  const connectOptions = one(connectCall.arguments.filter(node => node.type === 'ObjectExpression'), 'WP connect options');
  insert(connectOptions.start + 1, 'actorContext: l, targetContext: c, mode: r, ', 'session context options');
  const sessionRecord = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'ObjectExpression' && node.properties.some(property => property.key?.name === 'pedId' && property.value?.name === 't') && node.properties.some(property => property.key?.name === 'nonce' && property.value?.name === 's') && node.properties.some(property => property.key?.name === 'transport' && property.value?.name === 'p')) all.push(node); }); return all; })(), 'WP session record');
  insert(sessionRecord.start + 1, 'provider: p.provider || "gemini", systemInstruction: h, ', 'session provider state');
  const resumeProperty = one(sessionRecord.properties.filter(property => property.key?.name === 'resumeHandle'), 'WP resume handle');
  replace(resumeProperty.value.start, resumeProperty.value.end, 'p.provider === "openai" ? null : (' + source.slice(resumeProperty.value.start, resumeProperty.value.end) + ')', 'isolate Gemini resume handles');


  // Bind native identity before the controller sends text or microphone input.
  const xnBody = functionBody(ast, 'Xn');
  const ownerBind = one((() => { const all = []; walk(xnBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'tP') all.push(node); }); return all; })(), 'Xn native owner registration');
  insert(ownerBind.start, '(e.provider !== "openai" && ', 'OpenAI bypasses Gemini owner registration');
  insert(ownerBind.end, `), (i.metadata.provider = e.provider || "gemini", i.metadata.sessionNonce = e.nonce, i.metadata.actorContext = e.actorContext, i.metadata.targetContext = e.targetContext, e.provider === "openai" && e.connection.beginTurn({ identity: { pedId: i.pedId, turnId: i.id, generationId: i.generationId, sessionNonce: e.nonce }, source: i.source, context: { systemInstruction: e.systemInstruction, actor: e.actorContext, listener: e.targetContext, contextText: String(i.input?.contextText || ""), inputText: String(i.input?.transcript || i.input?.text || ""), internalEvent: i.source === Ht.SPECIAL_EVENT ? String(i.input?.text || i.input?.contextText || "") : "" } }))`, 'generation identity bind');

  // Route pinned HTTP output directly to the stock coordinator. Never infer identity from the active speaker.
  prelude('rP', 'if (t?.provider === "openai") return await globalThis.__LSA_E1_RUNTIME.host.routePinnedEvent(t);');
  prelude('_P', 'if (t?.metadata?.provider === "openai") return !1;');
  prelude('Sd', 'if (le.getTurn(t)?.metadata?.provider === "openai") return !1;');
  prelude('Td', 'if (e?.provider === "openai") { t.metadata.provider = "openai"; t.metadata.sessionNonce = e.nonce; return null; }');
  prelude('td', 'const __lsaE1Turn = le.getTurn(e); if (__lsaE1Turn?.metadata?.provider === "openai") return false;');
  for (const [name, reason] of [['Qi', 'native_interrupt'], ['hK', 'native_cancel']]) {
    prelude(name, `const __lsaE1Turn = le.getTurn(t); if (__lsaE1Turn?.metadata?.provider === "openai") globalThis.__LSA_E1_RUNTIME.abortTurn({ pedId: __lsaE1Turn.pedId, turnId: __lsaE1Turn.id, generationId: __lsaE1Turn.generationId, sessionNonce: __lsaE1Turn.metadata.sessionNonce }, "${reason}");`);
  }
  prelude('Zt', 'const __lsaE1FailTurn = le.getTurn(t); if (__lsaE1FailTurn?.metadata?.provider === "openai" && !Vt(__lsaE1FailTurn.status)) { globalThis.__LSA_E1_RUNTIME.abortTurn({ pedId: __lsaE1FailTurn.pedId, turnId: __lsaE1FailTurn.id, generationId: __lsaE1FailTurn.generationId, sessionNonce: __lsaE1FailTurn.metadata.sessionNonce }, "native_failure"); if (__lsaE1FailTurn.audio?.authorized && __lsaE1FailTurn.metadata.exactInterruptSent !== true) __lsaE1FailTurn.metadata.exactInterruptSent = Ey(yi(), _i(__lsaE1FailTurn), "openai_failure") > 0; }');

  prelude('a4', 'if (globalThis.__LSA_E1_RUNTIME.config.provider === "openai") { if (A.mic.pendingChunks.reduce((total, chunk) => total + chunk.length, 0) > globalThis.__LSA_E1_RUNTIME.config.maxMicPcmBytes) { const pendingTurn = le.getTurn(A.mic.activeTurnId); if (pendingTurn) Zt(pendingTurn.id, ke.CANCELLED, new Error("E1 microphone input exceeded its bound before hydration.")); el(); } return; }');
  prelude('yy', 'if (A.sessionsByPedId.get(Kn(t))?.provider === "openai") { if (iP(Kn(t)) !== Number(e)) throw new Error("Stale OpenAI session."); return true; }');
  const mkBody = functionBody(ast, 'mK');
  const audioBufferPush = one((() => { const all = []; walk(mkBody, node => { if (node.type === 'CallExpression' && memberName(node.callee) === 'push' && source.slice(node.start, node.end).startsWith('A.geminiAudioChunks.push')) all.push(node); }); return all; })(), 'mK Gemini debug audio buffer');
  replace(audioBufferPush.start, audioBufferPush.end, '(t.metadata?.provider !== "openai" && ' + source.slice(audioBufferPush.start, audioBufferPush.end) + ')', 'isolate Gemini debug PCM');
  prelude('CP', 'if (t?.metadata?.provider === "openai" && (!globalThis.__LSA_E1_RUNTIME.host.isCurrent({ pedId: t.pedId, turnId: t.id, generationId: t.generationId, sessionNonce: t.metadata.sessionNonce }) || !t.audio.accepted || t.audio.rejected || t.audio.streamEnded)) throw new Error("E1 PCM has no current native authorization.");');
  prelude('IP', 'if (t?.metadata?.provider === "openai" && (!globalThis.__LSA_E1_RUNTIME.host.isCurrent({ pedId: t.pedId, turnId: t.id, generationId: t.generationId, sessionNonce: t.metadata.sessionNonce }) || !t.audio.accepted || t.audio.rejected)) throw new Error("E1 stream end has no current native authorization.");');
  prelude('Rb', 'if (t?.metadata?.provider === "openai" && !globalThis.__LSA_E1_RUNTIME.host.isCurrent({ pedId: t.pedId, turnId: t.id, generationId: t.generationId, sessionNonce: t.metadata.sessionNonce })) return false;');
  // Stock cancellation did not interrupt authorized audio. OpenAI requires exact cleanup.
  insert(functionBody(ast, 'hK').start + 1, 'const __lsaE1Cancel = le.getTurn(t); if (__lsaE1Cancel?.metadata?.provider === "openai" && !Vt(__lsaE1Cancel.status) && __lsaE1Cancel.audio.authorized) Ey(yi(), _i(__lsaE1Cancel), "openai_cancel");', 'exact OpenAI cancellation');

  const qkBody = functionBody(ast, 'qK');
  insert(qkBody.end - 1, ';if (t.provider === "openai") { t.systemInstruction = BK(t.actorContext, t.targetContext, t.mode); t.connection.refreshContext({ systemInstruction: t.systemInstruction, actorContext: t.actorContext, targetContext: t.targetContext }); }', 'reused context refresh');

  const apBody = functionBody(ast, 'AP');
  const completeCall = one((() => { const all = []; walk(apBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'wP') all.push(node); }); return all; })(), 'AP TURN_COMPLETE');
  replace(completeCall.start, completeCall.end, 'wP(e, { allowExactSpeech: t.provider !== "openai" })', 'disable Gemini exact-speech recovery for OpenAI');

  const editsByLabel = new Set();
  for (const edit of edits) {
    if (edit.end < edit.start || edit.start < 0 || edit.end > source.length) throw new Error(`Invalid source edit: ${edit.label}`);
    if (!edit.label || editsByLabel.has(`${edit.start}:${edit.end}:${edit.label}`)) throw new Error(`Duplicate AST edit: ${edit.label}`);
    editsByLabel.add(`${edit.start}:${edit.end}:${edit.label}`);
  }
  edits.sort((left, right) => right.start - left.start || right.end - left.end);
  let output = source;
  for (const edit of edits) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  try { acorn.parse(output, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch (error) { error.message += `\nPatched source context: ${output.slice(Math.max(0, error.pos - 180), error.pos + 180)}`; throw error; }
  return { output, edits: edits.map(({ label, start, end, text }) => ({ label, start, end, insertedBytes: Buffer.byteLength(text) })) };
}

function sourceSlice(source, node) { return source.slice(node.start, node.end); }

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const item of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, item.name);
    const to = path.join(destination, item.name);
    if (item.isDirectory()) await copyDirectory(from, to);
    else if (item.isFile()) await copyFile(from, to);
  }
}

async function directoryDigest(directory) {
  const files = [];
  async function collect(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const file = path.join(current, item.name);
      if (item.isDirectory()) await collect(file);
      else if (item.isFile()) files.push(file);
    }
  }
  await collect(directory);
  files.sort((left, right) => path.relative(directory, left).localeCompare(path.relative(directory, right)));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(directory, file).split(path.sep).join('/')).update('\0');
    hash.update(await readFile(file)).update('\0');
  }
  return hash.digest('hex');
}

export async function buildCandidate({ sourcePath = stockBundleDefault, outputPath = path.join(root, 'dist/plugins/LosSantosAliveServer') } = {}) {
  const target = await assertNoLinkedOutput(outputPath);
  const source = await readFile(sourcePath, 'utf8');
  const sourceHash = digest(source);
  if (sourceHash !== expectedBundleHash) throw new Error(`Pinned Essential backend changed: expected ${expectedBundleHash}, found ${sourceHash}. Re-audit seams before rebuilding.`);
  const dllHash = await fileHash(stockDllDefault);
  if (dllHash !== expectedDllHash) throw new Error(`Pinned Essential DLL changed: expected ${expectedDllHash}, found ${dllHash}. Re-audit the baseline before rebuilding.`);
  const nativeContract = await verifyNativeContract(dllHash, { expectedMetadataSha256: expectedNativeMetadataHash });
  const patched = patchSource(source);
  const entry = path.join(target, launcherName);
  const stagedE1 = path.join(target, 'e1');
  const src = path.join(root, 'src');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await writeFile(entry, patched.output, 'utf8');
  await copyDirectory(src, stagedE1);
  await copyFile(path.join(root, 'e1.config.example.json'), path.join(target, 'e1.config.example.json'));
  const e1SourceTreeSha256 = await directoryDigest(stagedE1);
  const releasePayloadSha256 = await directoryDigest(target);
  const manifest = {
    nativeContract,
    stage: 'E5/E6', foundationStage: 'E1.1+E2+E3', status: 'candidate-built-offline-verified-live-api-and-gta-pending', observabilitySchemaVersion: 1,
    features: { structuredStreaming: true, earlySegmentedTts: true, defaultEnabled: false, earlyTtsMode: 'dialogue_only', ttsConcurrency: 1 },
    launcherEntry: launcherName, upstreamBundleSha256: sourceHash,
    stockDllReferenceSha256: dllHash, builtBundleSha256: digest(patched.output),
    e1SourceTreeSha256, releasePayloadSha256,
    astPatchCount: patched.edits.length, astPatches: patched.edits,
    externalRuntimePackaging: 'not included; no GTA-folder deployment performed',
    realApiCalls: false, gtaRuntimeTest: false,
  };
  await writeFile(path.join(target, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { target, manifest };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const result = await buildCandidate({ sourcePath: process.env.LSA_E1_SOURCE || stockBundleDefault });
  console.log(JSON.stringify({ target: result.target, status: result.manifest.status, hash: result.manifest.builtBundleSha256, patchCount: result.manifest.astPatchCount }, null, 2));
}
