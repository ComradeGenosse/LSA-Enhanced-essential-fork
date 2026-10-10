import {verifyDialogueKnowledgePayload} from './verifyDialogueKnowledgePayload.mjs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyNativeContract } from './verifyNativeContract.mjs';
import { verifyIdentityContract } from './verifyIdentityContract.mjs';
import { verifyCharactersContract } from './verifyCharactersContract.mjs';
import { verifyPerceptionContract } from './verifyPerceptionContract.mjs';
import { assertCandidateWriteTarget, assertNoLinkedOutput, candidateRootPath } from './checkIsolation.mjs';

const root = candidateRootPath();
const require = createRequire(import.meta.url);
const acorn = require('./vendor/acorn');
const expectedBundleHash = '5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2';
const expectedDllHash = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
const expectedNativeMetadataHash = '18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23';
const expectedPatchCount = 55;
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
    `  retireMatchingSession(session, reason) { const live = A.sessionsByPedId.get(session.pedId); if (live?.provider !== "openai" || live.nonce !== session.sessionNonce || iP(session.pedId) !== session.sessionNonce) return false; const turn=le.getActiveTurnForPed(session.pedId); if (turn?.metadata?.provider === "openai" && turn.metadata.sessionNonce === session.sessionNonce && !Vt(turn.status)) Zt(turn.id, ke.CANCELLED, new Error("identity_retired")); return Ei(session.pedId, "identity_retired"); },\n` +
    `  directorTurnPrioritySnapshot() { try { const m=A.mic; if(!m || !Array.isArray(m.pendingChunks) || typeof m.status !== "string" || typeof m.activeTurnId !== "string" || typeof m.releasedBeforeContextReady !== "boolean") return null; const maps=[A.turnsById,A.activeTurnIdByPedId,A.sessionOpenPromisesByPedId,A.pendingOutputOwnerByPedId,A.retiringOutputOwnerByPedId,A.outputOwnerByPedId,A.pendingPlayerContextByPedId,A.pendingConversationContextByPedId,A.playerTurnRecoveryByTurnId]; if(!maps.every(v=>v instanceof Map))return null; return __LSA_E1_RUNTIME.projectOriginalTurnPriority({micStatus:m.status,micActiveTurnId:m.activeTurnId,micReleasedBeforeContextReady:m.releasedBeforeContextReady,micBufferedChunks:m.pendingChunks.length,liveTurns:[...A.turnsById.values()].filter(t=>t && !Vt(t.status)).length,activeTurnMappings:A.activeTurnIdByPedId.size,pendingSessionOpens:A.sessionOpenPromisesByPedId.size,pendingOutputOwners:A.pendingOutputOwnerByPedId.size,retiringOutputOwners:A.retiringOutputOwnerByPedId.size,activeOutputOwners:A.outputOwnerByPedId.size,pendingPlayerContext:A.pendingPlayerContextByPedId.size,pendingConversationContext:A.pendingConversationContextByPedId.size,playerTurnRecoveries:A.playerTurnRecoveryByTurnId.size}); } catch { return null; } },\\n` +
    `  isCurrent(identity) { const turn = le.getTurn(identity.turnId); const session = A.sessionsByPedId.get(identity.pedId); return !!turn && !Vt(turn.status) && turn.metadata?.provider === "openai" && turn.metadata?.sessionNonce === identity.sessionNonce && turn.pedId === identity.pedId && turn.generationId === identity.generationId && le.isCurrentGeneration(turn) && iP(identity.pedId) === identity.sessionNonce && session?.provider === "openai" && session.nonce === identity.sessionNonce; },\n` +
    `  reportTargetRejection(turn, error) { const reason = ["target_changed","target_missing","target_invalid"].includes(error?.code) ? error.code : ""; if (!reason || !turn || turn.metadata?.targetRejectionReported) return false; turn.metadata.targetRejectionReported = true; try { __LSA_E1_RUNTIME.telemetry?.emit(reason, { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce }, turn.source, { reason, outcome: "rejected" }); } catch {} return true; },\n` +
    `  reportReferenceMapChange(turn, snapshot, actor) { if (!turn || turn.metadata?.referenceMapChangeReported) return false; const currentMap = __LSA_E1_RUNTIME.captureReferenceMap(actor); const stableMap = value => JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([left],[right]) => left.localeCompare(right)))); if (stableMap(snapshot?.persons) === stableMap(currentMap.persons) && stableMap(snapshot?.vehicles) === stableMap(currentMap.vehicles)) return false; turn.metadata.referenceMapChangeReported = true; try { __LSA_E1_RUNTIME.telemetry?.emit("reference_map_revision_changed", { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce }, turn.source, { reason: "reference_map_revision_changed", outcome: "changed" }); } catch {} return true; },\n` +
    `  validateDecision(decision, context, identity) { if (!this.isCurrent(identity)) return { identityValid: false }; const turn = le.getTurn(identity.turnId); const session = A.sessionsByPedId.get(identity.pedId); const actor = Sb(identity.pedId) || session?.actorContext || context.actor || {}; const allowedActionNames = new Set(ra(actor).map(item => h4(String(item.tag || "").split(/[\\s<]/, 1)[0])).filter(Boolean)); const person = reference => { const refs = actor?.nearbyPersonReferences; const value = refs instanceof Map ? refs.get(reference) : refs?.[reference] ?? refs?.[String(reference).toUpperCase()]; return value && typeof value === "object" ? value.pedId || value.id || null : value || null; }; const vehicle = reference => { const refs = actor?.nearbyVehicleReferences; const value = refs instanceof Map ? refs.get(reference) : refs?.[reference] ?? refs?.[String(reference).toUpperCase()]; return value && typeof value === "object" ? value.vehicleId || value.id || null : value || null; }; const snapshot = turn?.metadata?.contextSnapshot || Object.freeze({ identity: Object.freeze({ ...identity }), actor: context.actor, listener: context.listener, listenerState: context.listenerState, world: context.world, referenceMap: context.referenceMap, capturedAt: context.capturedAt, revision: context.revision }); this.reportReferenceMapChange(turn, snapshot.referenceMap, actor); let result; try { result = __LSA_E1_RUNTIME.validateStockDecision(decision, { identity, actor, referenceSnapshot: snapshot.referenceMap, allowedActionNames, parseActions: Cb, resolvePerson: person, resolveVehicle: vehicle }); } catch (error) { this.reportTargetRejection(turn, error); throw error; } if (turn) { turn.metadata.contextSnapshot = snapshot; turn.metadata.targetReferenceBindings = result.referenceBindings; } return result; },\n` +
    `  validateTurnAction(turn) { if (turn?.metadata?.provider !== "openai") return true; const snapshot = turn.metadata.contextSnapshot; if (!snapshot || !this.isCurrent({ pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce })) return false; const parsed = Cb(String(turn.output?.finalTranscript || turn.output?.transcript || "")); if (!parsed.length) return true; if (parsed.length !== 1) return false; const session = A.sessionsByPedId.get(turn.pedId); const actor = Sb(turn.pedId) || session?.actorContext || {}; this.reportReferenceMapChange(turn, snapshot.referenceMap, actor); const allowedActionNames = new Set(ra(actor).map(item => h4(String(item.tag || "").split(/[\\s<]/, 1)[0])).filter(Boolean)); const person = reference => { const refs = actor?.nearbyPersonReferences; const value = refs instanceof Map ? refs.get(reference) : refs?.[reference] ?? refs?.[String(reference).toUpperCase()]; return value && typeof value === "object" ? value.pedId || value.id || null : value || null; }; const vehicle = reference => { const refs = actor?.nearbyVehicleReferences; const value = refs instanceof Map ? refs.get(reference) : refs?.[reference] ?? refs?.[String(reference).toUpperCase()]; return value && typeof value === "object" ? value.vehicleId || value.id || null : value || null; }; try { const checked = __LSA_E1_RUNTIME.validateStockDecision({ dialogue: "Dispatch validation.", command: parsed[0].tag }, { identity: { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce }, actor, referenceSnapshot: snapshot.referenceMap, allowedActionNames, parseActions: Cb, resolvePerson: person, resolveVehicle: vehicle }); return JSON.stringify(checked.referenceBindings) === JSON.stringify(turn.metadata.targetReferenceBindings || { persons: {}, vehicles: {} }); } catch (error) { this.reportTargetRejection(turn, error); return false; } },\n` +
    `  async routePinnedEvent(event) { if (!this.isCurrent(event) || event.provider !== "openai") return false; this.assertCapabilities(); const nativeTurn = le.getTurn(event.turnId); const metrics = nativeTurn && __LSA_E1_RUNTIME.telemetry?.beginTurn({ pedId: nativeTurn.pedId, turnId: nativeTurn.id, generationId: nativeTurn.generationId, sessionNonce: nativeTurn.metadata.sessionNonce }, nativeTurn.source || "player_text"); const actionRoute = event.type === Ee.OUTPUT_TRANSCRIPT && metrics?.hasAction; if (actionRoute) metrics.actionDispatchStart(); try { const routed = await AP(event); if (actionRoute) metrics.actionDispatchEnd(routed === true); return routed; } catch (error) { if (actionRoute) metrics.actionDispatchEnd(false); throw error; } },\n` +
    `  authorize(identity) { if (!this.isCurrent(identity)) return false; this.assertCapabilities(); const turn = le.getTurn(identity.turnId); RP(turn); return true; },\n` +
    `  assertCapabilities() { const endpoint = A.audioEndpoint; if (!endpoint?.connected || !endpoint.ready || endpoint.protocolVersion !== 3 || !endpoint.supportsTurnIdentity || !endpoint.supportsStreamEnded || !endpoint.supportsExactInterrupt || !endpoint.supportsPlaybackStarted || !endpoint.supportsStaleGenerationRejection) throw new Error("E1 requires the Hotfix 3 tagged playback contract."); },\n` +
    `  onNativeEvent(listener) { return xn(event => { const turn = event?.turn; if (turn?.metadata?.provider !== "openai") return; if (iP(turn.pedId) !== turn.metadata.sessionNonce) return; const msg = event.message || {}; listener({ type: event.type, pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: turn.metadata.sessionNonce, reason: String(msg.reason || event.reason || ""), wasInterrupted: msg.wasInterrupted === true, hadAudio: msg.hadAudio === true, playbackStarted: msg.playbackStarted === true }); }); },\n` +
    `  failMatchingTurn(identity, error) { const turn = le.getTurn(identity.turnId); if (!turn || Vt(turn.status) || turn.pedId !== identity.pedId || turn.metadata?.provider !== "openai" || turn.metadata?.sessionNonce !== identity.sessionNonce || turn.generationId !== identity.generationId) return false; const attempted = Number(turn.output?.audioChunkCount || 0) > 0 || turn.audio?.playbackStarted === true; Zt(turn.id, attempted ? ke.PLAYBACK_ERROR : ke.GEMINI_ERROR, error); return true; },\n` +
    `  log(identity, event, details = {}) { se("E1", event, { pedId: identity.pedId, turnId: identity.turnId, generationId: identity.generationId, sessionNonce: identity.sessionNonce, provider: "openai", source: details.source, terminalReason: details.reason, stage: details.stage, cause: details.cause }); },\n` +
    `});\n`, 'Essential provider/action/playback bridge');

  // The adapter receives the current player/actor snapshot along with the stock prompt.
  const wpBody = functionBody(ast, 'WP');
  const wpOptions = functions(ast, 'WP')[0].params[0];
  if (wpOptions?.type !== 'ObjectPattern') throw new Error('WP session options no longer use a destructured object.');
  insert(wpOptions.start + 1, 'world: w, ', 'session world option');
  const connectCall = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'CallExpression' && memberName(node.callee) === 'connect') all.push(node); }); return all; })(), 'WP transport.connect');
  const connectOptions = one(connectCall.arguments.filter(node => node.type === 'ObjectExpression'), 'WP connect options');
  insert(connectOptions.start + 1, 'actorContext: l, targetContext: c, world: w, mode: r, ', 'session context options');
  const sessionRecord = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'ObjectExpression' && node.properties.some(property => property.key?.name === 'pedId' && property.value?.name === 't') && node.properties.some(property => property.key?.name === 'nonce' && property.value?.name === 's') && node.properties.some(property => property.key?.name === 'transport' && property.value?.name === 'p')) all.push(node); }); return all; })(), 'WP session record');
  insert(sessionRecord.start + 1, 'provider: p.provider || "gemini", systemInstruction: h, world: w, ', 'session provider state');
  const resumeProperty = one(sessionRecord.properties.filter(property => property.key?.name === 'resumeHandle'), 'WP resume handle');
  replace(resumeProperty.value.start, resumeProperty.value.end, 'p.provider === "openai" ? null : (' + source.slice(resumeProperty.value.start, resumeProperty.value.end) + ')', 'isolate Gemini resume handles');
  const wpPrompt = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'BK') all.push(node); }); return all; })(), 'WP prompt generation');
  replace(wpPrompt.start, wpPrompt.end, 'BK(l,c,r,w)', 'bind prompt to session world');
  const resumeRetry = one((() => { const all = []; walk(wpBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'WP' && node.arguments[0]?.type === 'ObjectExpression' && sourceSlice(source,node.arguments[0]).includes('allowFreshRetryAfterResumeFailure:!1')) all.push(node); }); return all; })(), 'WP resume fallback');
  insert(resumeRetry.arguments[0].start + 1, 'world: w, ', 'resume fallback world');


  // Bind native identity before the controller sends text or microphone input.
  const xnBody = functionBody(ast, 'Xn');
  const ownerBind = one((() => { const all = []; walk(xnBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'tP') all.push(node); }); return all; })(), 'Xn native owner registration');
  insert(ownerBind.start, '(e.provider !== "openai" && ', 'OpenAI bypasses Gemini owner registration');
  insert(ownerBind.end, `), (i.metadata.provider = e.provider || "gemini", i.metadata.sessionNonce = e.nonce, (() => { const __lsaTurnActor = Object.prototype.hasOwnProperty.call(i.metadata, "actorContext") ? i.metadata.actorContext : e.actorContext; const __lsaTurnListener = Object.prototype.hasOwnProperty.call(i.metadata, "targetContext") ? i.metadata.targetContext : e.targetContext; const __lsaTurnWorld = Object.prototype.hasOwnProperty.call(i.metadata, "world") ? i.metadata.world : e.world; i.metadata.actorContext = __lsaTurnActor; i.metadata.targetContext = __lsaTurnListener; i.metadata.world = __lsaTurnWorld; if (e.provider === "openai") { e.connection.beginTurn({ identity: { pedId: i.pedId, turnId: i.id, generationId: i.generationId, sessionNonce: e.nonce }, source: i.source, context: { systemInstruction: e.systemInstruction, actor: __lsaTurnActor, listener: __lsaTurnListener, listenerState: i.metadata.listenerState, world: __lsaTurnWorld, capturedAt: i.metadata.contextCapturedAt, revision: i.metadata.contextRevision, directorTicket: i.metadata.directorTicket ?? null, contextText: String(i.input?.contextText || ""), inputText: String(i.input?.transcript || i.input?.text || ""), internalEvent: i.source === Ht.SPECIAL_EVENT ? String(i.input?.text || i.input?.contextText || "") : "" } }); i.metadata.contextSnapshot = e.connection.turnSnapshot; } })())`, 'generation identity bind');

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
  prelude('Rb', 'if (t?.metadata?.provider === "openai" && (!globalThis.__LSA_E1_RUNTIME.host.isCurrent({ pedId: t.pedId, turnId: t.id, generationId: t.generationId, sessionNonce: t.metadata.sessionNonce }) || !globalThis.__LSA_E1_RUNTIME.host.validateTurnAction(t))) return false;');
  // Stock cancellation did not interrupt authorized audio. OpenAI requires exact cleanup.
  insert(functionBody(ast, 'hK').start + 1, 'const __lsaE1Cancel = le.getTurn(t); if (__lsaE1Cancel?.metadata?.provider === "openai" && !Vt(__lsaE1Cancel.status) && __lsaE1Cancel.audio.authorized) Ey(yi(), _i(__lsaE1Cancel), "openai_cancel");', 'exact OpenAI cancellation');

  // Preserve an explicit listener clear before stock oa normalizes nested context.
  const oaBody = functionBody(ast, 'oa');
  const oaTarget = one((() => { const all = []; walk(oaBody, node => { if (node.type === 'VariableDeclarator' && node.id?.name === 'r' && sourceSlice(source, node.init) === 'e?ia(t.target,"target"):CO(t)') all.push(node); }); return all; })(), 'oa normalized target context');
  replace(oaTarget.init.start, oaTarget.init.end, 'Object.prototype.hasOwnProperty.call(t,"target")&&t.target===null?null:e?ia(t.target,"target"):CO(t)', 'retain explicit null listener through stock normalization');

  // M4 hydrates actor and listener separately; listener world must never fill a missing actor world.
  const m4Body = functionBody(ast, 'M4');
  const listenerWorldFallback = one((() => { const all = []; walk(m4Body, node => { if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier' && node.left.name === 'o' && node.right?.type === 'ObjectExpression' && node.right.properties.some(property => property.type === 'SpreadElement' && property.argument?.type === 'MemberExpression' && property.argument.object?.name === 's' && property.argument.property?.name === 'world')) all.push(node); }); return all; })(), 'M4 listener world fallback');
  replace(listenerWorldFallback.start, listenerWorldFallback.end, 'null', 'keep listener world out of actor snapshot');

  const qkBody = functionBody(ast, 'qK');
  const qkOptions = functions(ast, 'qK')[0].params[1];
  if (qkOptions?.type !== 'ObjectPattern') throw new Error('qK refresh options no longer use a destructured object.');
  insert(qkOptions.start + 1, 'listenerProvided: u, world: w, ', 'qK listener and world operation');
  const listenerAssignment = one((() => { const all = []; walk(qkBody, node => { if (node.type === 'AssignmentExpression' && memberName(node.left) === 'targetContext' && isIdentifier(node.left.object,'t')) all.push(node); }); return all; })(), 'qK listener refresh');
  replace(listenerAssignment.start, listenerAssignment.end, 't.targetContext=u?(n?pd(n):null):t.targetContext', 'retain omitted listener and clear explicit null');
  insert(qkBody.end - 1, ';t.world=w;if (t.provider === "openai") { t.systemInstruction = BK(t.actorContext, t.targetContext, t.mode, t.world); t.connection.refreshContext({ systemInstruction: t.systemInstruction, actorContext: t.actorContext, targetContext: t.targetContext, world: t.world }); }', 'reused actor listener world snapshot refresh');

  const bkParams = functions(ast, 'BK')[0].params;
  if (bkParams.length !== 3) throw new Error('BK prompt function parameter count changed.');
  insert(bkParams[2].end, ',__lsaWorldSnapshot', 'BK explicit world snapshot parameter');
  const bkWorld = one((() => { const all = []; walk(functionBody(ast,'BK'), node => { if (node.type === 'Property' && node.key?.name === 'world') all.push(node); }); return all; })(), 'BK current world property');
  replace(bkWorld.value.start, bkWorld.value.end, '__lsaWorldSnapshot&&typeof __lsaWorldSnapshot==="object"?{gameTime:__lsaWorldSnapshot.gameTime??"unknown",weather:__lsaWorldSnapshot.weather??"unknown",streetName:__lsaWorldSnapshot.streetName??"unknown",crossingStreetName:__lsaWorldSnapshot.crossingStreetName??"unknown",zoneCode:__lsaWorldSnapshot.zoneCode??"unknown"}:{gameTime:"unknown",weather:"unknown",streetName:"unknown",crossingStreetName:"unknown",zoneCode:"unknown"}', 'world context has explicit unknown semantics');

  const bkReturns=[];walk(functionBody(ast,'BK'),node=>{if(node.type==='ReturnStatement')bkReturns.push(node);});
  const npcReturn=one(bkReturns,'BK speech-mode return').argument;
  if(npcReturn?.type!=='ConditionalExpression' || npcReturn.alternate?.type!=='BinaryExpression' || npcReturn.alternate.operator!=='+' || npcReturn.alternate.right?.type!=='TemplateLiteral' || npcReturn.alternate.right.expressions.length)throw new Error('BK trusted NPC speech suffix changed.');
  const npcSuffix=sourceSlice(source,npcReturn.alternate.right);
  prelude('BK', `t=__LSA_E1_RUNTIME.modelActor(t); e=__LSA_E1_RUNTIME.modelActor(e); if(__LSA_E1_RUNTIME.config.provider==="openai") return __LSA_E1_RUNTIME.separateKnowledgeInstruction(dM(t)) + (String(n||"").toLowerCase()==="npc"&&e?${npcSuffix}:"");`);

  // Exact return seams: capture source presence before AO/CO's alias/default
  // transformations can turn omission into an apparently known false value.
  for(const [name,shape] of [['ia','direct'],['AO','actor'],['CO','listener'],['eo','hydrated']]) {
    const returns=[];walk(functionBody(ast,name),node=>{if(node.type==='ReturnStatement')returns.push(node);});
    const value=one(returns,`${name} normalization return`).argument;
    replace(value.start,value.end,`__LSA_E1_RUNTIME.captureNormalizedActor((${sourceSlice(source,value)}),t,"${shape}")`,`${name} private source presence`);
  }


  // Reserved identity evidence never flattens into native fields/capabilities,
  // including when P1 is disabled or a forged/unsupported block is supplied.
  const eoIdentityGuard = one((() => { const all = []; walk(functionBody(ast, 'EO'), node => {
    if (node.type === 'BinaryExpression' && sourceSlice(source,node) === 'o!=="raw"') all.push(node);
  }); return all; })(), 'EO reserved identity namespace');
  replace(eoIdentityGuard.start, eoIdentityGuard.end, '(o!=="raw"&&o!=="sessionIdentity"&&o!=="characterProfile"&&o!=="turnKnowledge")', 'keep private evidence namespaced');

  const ziBody = functionBody(ast, 'Zi');
  const ziParam = functions(ast, 'Zi')[0].params[0];
  const ziOptions = ziParam?.type === 'AssignmentPattern' ? ziParam.left : ziParam;
  if (ziOptions?.type !== 'ObjectPattern') throw new Error('Zi session options no longer use a destructured object.');
  insert(ziOptions.start + 1, 'world: __lsaWorldInput, ', 'Zi world input');
  insert(ziBody.start + 1, 'const __lsaListenerProvided = arguments[0]?.listenerProvided !== undefined ? arguments[0].listenerProvided === true : arguments[0]?.targetContext !== undefined; const __lsaWorldProvided = arguments[0]?.world !== undefined; const __lsaActorWorld = e && Object.prototype.hasOwnProperty.call(e,"world") ? e.world : String(A.context?.speaker?.pedId || "") === String(e?.pedId || "") ? A.context?.world : null; const __lsaInputWorld = __lsaWorldProvided ? __lsaWorldInput : __lsaActorWorld; const __lsaResolvedWorld = __lsaInputWorld && typeof __lsaInputWorld === "object" ? { gameTime: __lsaInputWorld.gameTime ?? "unknown", weather: __lsaInputWorld.weather ?? "unknown", streetName: __lsaInputWorld.streetName ?? "unknown", crossingStreetName: __lsaInputWorld.crossingStreetName ?? "unknown", zoneCode: __lsaInputWorld.zoneCode ?? "unknown" } : { gameTime: "unknown", weather: "unknown", streetName: "unknown", crossingStreetName: "unknown", zoneCode: "unknown" };', 'capture actor-associated listener and world at session entry');
  const ziRefresh = one((() => { const all = []; walk(ziBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'qK') all.push(node); }); return all; })(), 'Zi reused session refresh');
  insert(ziRefresh.arguments[1].start + 1, 'listenerProvided: __lsaListenerProvided, world: __lsaResolvedWorld, ', 'Zi reused listener and world');
  const ziOpen = one((() => { const all = []; walk(ziBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'WP' && node.arguments[0]?.type === 'ObjectExpression') all.push(node); }); return all; })(), 'Zi new session open');
  insert(ziOpen.arguments[0].start + 1, 'world: __lsaResolvedWorld, ', 'Zi new session world');
  const openWaitRefresh = one((() => { const all = []; walk(ziBody, node => { if (node.type === 'ReturnStatement' && sourceSlice(source,node).includes('waitedForOpen')) all.push(node); }); return all; })(), 'Zi pending open completion');
  insert(openWaitRefresh.start, 'if(d?.status==="ready"&&d.connection)qK(d,{actorContext:e,targetContext:n,listenerProvided:__lsaListenerProvided,world:__lsaResolvedWorld,mode:r,setAsPrimarySession:i});', 'refresh context after shared session open');

  // Player text captures its own listener/world before any asynchronous hydration or interruption work.
  const ibBody = functionBody(ast, 'ib');
  const ibActorCapture = one((() => { const all = []; walk(ibBody, node => { if (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id?.name === 'e' && sourceSlice(source,item.init) === 'A.activeActor')) all.push(node); }); return all; })(), 'ib input context capture');
  insert(ibActorCapture.end, 'const __lsaListenerProvided = Object.prototype.hasOwnProperty.call(t,"target") && t.target !== undefined; const __lsaExistingSession = A.sessionsByPedId.get(r); n = __lsaListenerProvided ? (t.target === null ? null : A.context?.target || t.target) : (__lsaExistingSession ? __lsaExistingSession.targetContext : A.context?.target ?? null); const __lsaWorld = String(A.context?.speaker?.pedId || "") === r ? A.context?.world : (Object.prototype.hasOwnProperty.call(t,"world") ? t.world : null);', 'typed turn listener and world capture');
  const ibTurn = one((() => { const all = []; walk(ibBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'Xi') all.push(node); }); return all; })(), 'ib native turn creation');
  const ibTurnOptions = ibTurn.arguments[0];
  const ibMetadata = one(ibTurnOptions.properties.filter(property => property.key?.name === 'metadata'), 'ib turn metadata');
  insert(ibMetadata.value.start + 1, 'world: __lsaWorld, listenerState: __lsaListenerProvided ? (n === null ? "explicitly_cleared" : "present") : "omitted", contextCapturedAt: new Date().toISOString(), contextRevision: e?.snapshotRevision ?? e?.revision ?? null, ', 'typed turn context capture metadata');
  const hydrationListenerCopy=[];
  walk(functionBody(ast,'M4'),node=>{if(node.type==='ObjectExpression' && sourceSlice(source,node)==='{...i,pedId:e,id:e}')hydrationListenerCopy.push(node);});
  const hydratedCopy=one(hydrationListenerCopy,'M4 hydrated listener presence copy');
  replace(hydratedCopy.start,hydratedCopy.end,`__LSA_E1_RUNTIME.copyActorPresence(i,${sourceSlice(source,hydratedCopy)})`,'M4 preserve hydrated listener presence');

  const ibEnsure = one((() => { const all = []; walk(ibBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'Zi') all.push(node); }); return all; })(), 'ib session setup');
  insert(ibEnsure.arguments[0].start + 1, 'world: __lsaWorld, listenerProvided: __lsaListenerProvided, ', 'typed session listener and world association');

  const actorCopyReturns=[];
  walk(functionBody(ast,'pd'),node=>{if(node.type==='ReturnStatement')actorCopyReturns.push(node);});
  const actorCopy=one(actorCopyReturns,'pd normalized actor copy').argument;
  replace(actorCopy.start,actorCopy.end,`(__LSA_E1_RUNTIME.copyActorPresence(t,(${sourceSlice(source,actorCopy)})))`,'pd preserve private actor presence');

  // Microphone hydration refreshes the turn from the same addressed actor before the provider binds identity.
  const wdBody = functionBody(ast, 'wd');
  const wdActorCapture = one((() => { const all = []; walk(wdBody, node => { if (node.type === 'VariableDeclaration' && node.declarations.some(item => item.id?.name === 'r' && sourceSlice(source,item.init) === 'A.activeActor')) all.push(node); }); return all; })(), 'wd hydrated actor capture');
  insert(wdActorCapture.end, 'const __lsaMicListenerProvided = Object.prototype.hasOwnProperty.call(t,"target") && t.target !== undefined; const __lsaExistingMicSession = A.sessionsByPedId.get(o); i = __lsaMicListenerProvided ? (t.target === null ? null : A.context?.target || t.target) : (__lsaExistingMicSession ? __lsaExistingMicSession.targetContext : A.context?.target ?? null); const __lsaMicWorld = String(A.context?.speaker?.pedId || "") === o ? A.context?.world : (Object.prototype.hasOwnProperty.call(t,"world") ? t.world : null); n.metadata.world = __lsaMicWorld; n.metadata.listenerState = __lsaMicListenerProvided ? (i === null ? "explicitly_cleared" : "present") : "omitted"; n.metadata.contextCapturedAt = new Date().toISOString(); n.metadata.contextRevision = r?.snapshotRevision ?? r?.revision ?? null;', 'microphone turn listener and world hydration capture');
  const wdEnsure = one((() => { const all = []; walk(wdBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'Zi') all.push(node); }); return all; })(), 'wd session setup');
  insert(wdEnsure.arguments[0].start + 1, 'world: __lsaMicWorld, listenerProvided: __lsaMicListenerProvided, ', 'microphone session listener and world association');

  // Internal/special events already hydrate actor, listener and world together in M4.
  const kbBody = functionBody(ast, 'kb');
  // A claimed PS6 ticket (or reserved namespace) must have independent
  // same-user native admission BEFORE stock M4 performs any async hydration.
  // All ordinary Essential special events retain the stock path.
  insert(kbBody.start+1, 'if ((t?.directorTicket !== undefined || String(t?.dedupeKey || "").startsWith("ps:") || t?.reason === "ps6_observer") && __LSA_E1_RUNTIME.directorPreflight(t) !== true) return false;', 'PS6 original ticket checked before kb hydration');
  const kbEnsure = one((() => { const all = []; walk(kbBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'Zi') all.push(node); }); return all; })(), 'kb special-event session setup');
  insert(kbEnsure.arguments[0].start + 1, 'world: h.world, ', 'special-event session world association');
  const kbTurn = one((() => { const all = []; walk(kbBody, node => { if (node.type === 'CallExpression' && node.callee.name === 'Xi') all.push(node); }); return all; })(), 'kb special-event turn creation');
  const kbMetadata = one(kbTurn.arguments[0].properties.filter(property => property.key?.name === 'metadata'), 'kb special-event turn metadata');
  insert(kbMetadata.value.start + 1, 'directorTicket: t?.directorTicket ? __LSA_E1_RUNTIME.requireDirectorTicket(t,h) : undefined, listenerState: n ? "present" : "explicitly_cleared", contextCapturedAt: new Date().toISOString(), contextRevision: h.actorContext?.snapshotRevision ?? h.actorContext?.revision ?? null, ', 'special-event context capture metadata');

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

export async function buildCandidate({ nativePayloadPath, sourcePath = stockBundleDefault, outputPath = path.join(root, 'dist/plugins/LosSantosAliveServer') } = {}) {
  const target = await assertNoLinkedOutput(outputPath);
  const source = await readFile(sourcePath, 'utf8');
  const sourceHash = digest(source);
  if (sourceHash !== expectedBundleHash) throw new Error(`Pinned Essential backend changed: expected ${expectedBundleHash}, found ${sourceHash}. Re-audit seams before rebuilding.`);
  const dllHash = await fileHash(stockDllDefault);
  if (dllHash !== expectedDllHash) throw new Error(`Pinned Essential DLL changed: expected ${expectedDllHash}, found ${dllHash}. Re-audit the baseline before rebuilding.`);
  const nativeContract = await verifyNativeContract(dllHash, { expectedMetadataSha256: expectedNativeMetadataHash });
  const identityContract = await verifyIdentityContract(dllHash);
  const characterContract = await verifyCharactersContract(dllHash);
  const perceptionContract = await verifyPerceptionContract(dllHash);
  const knowledgePayload=await verifyDialogueKnowledgePayload(nativePayloadPath,perceptionContract);
  const patched = patchSource(source);
  if (patched.edits.length !== expectedPatchCount) throw new Error(`AST patch inventory changed: expected ${expectedPatchCount}, found ${patched.edits.length}. Re-audit the source seam list before building.`);
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
    identityContract,
    characterContract,
    perceptionContract,
    dialogueKnowledgeContract:knowledgePayload.contract,
    dialogueKnowledgeNativePayload:knowledgePayload.nativePayload,
    stage: 'PS4 DIALOGUE KNOWLEDGE + PS3/PS2/PS1/PS0/P2', foundationStage: 'P2+P0+P1+E1.1+E2+E3+E5+E6', status: 'candidate-built-offline-ps4-gta-pending', observabilitySchemaVersion: 1, dialogueTraceSchemaVersion: 1,
    features: { structuredStreaming: true, earlySegmentedTts: true, defaultEnabled: false, earlyTtsMode: 'dialogue_only', ttsConcurrency: 1,
      sessionIdentity: { defaultEnabled: false, modes: ['shadow','voices'], storeSchemaVersion: 1, nativeAddressing: 'unchanged' },
      promotedCharacters: { defaultEnabled:false,profileStoreSchemaVersion:1,manualMemoryOnly:true,requiresAuthoredP1Owner:true,nativeAddressing:'unchanged',summonWaitMs:30000,maxSummonWaitMs:60000 },
      intelligence: {defaultMode:'off',modes:['off','shadow'],phases:['PS0','PS1','PS2','PS3'],witness:'source_sample_visual',playerSpeech:'disabled_unsupported_capture_receipt',salience:'deterministic_local',responderSelection:false,modelContext:knowledgePayload.contract.available,automaticMemory:false,initiative:false},
      dialogueKnowledge:{safeBase:true,frameVersion:1,optionalPerceptionDelivery:knowledgePayload.contract.available,sourcePresence:true,frameBytes:112*1024,requestBytes:160*1024},
      dialogueLogging: { defaultEnabled:false,provider:'openai',storage:'rotating-jsonl' } },
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
  const result = await buildCandidate({ sourcePath: process.env.LSA_E1_SOURCE || stockBundleDefault,nativePayloadPath:process.env.LSA_PS4_NATIVE_PAYLOAD });
  console.log(JSON.stringify({ target: result.target, status: result.manifest.status, hash: result.manifest.builtBundleSha256, patchCount: result.manifest.astPatchCount }, null, 2));
}
