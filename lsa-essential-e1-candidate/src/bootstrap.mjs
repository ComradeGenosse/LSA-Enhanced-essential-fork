import {projectCapabilityHealth,loadCapabilityValidation} from './observability/capabilityHealth.mjs';
import {createHash} from 'node:crypto';
import {dialogueKnowledgeContractSupported} from './config/dialogueKnowledge.mjs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config/e1Config.mjs';
import { createRuntime } from './integration/essentialGlue.mjs';
import { loadPrivateEnvironment } from './config/privateEnvironment.mjs';
import { createFileSink } from './observability/fileSink.mjs';
import { Telemetry, createNoopTelemetry } from './observability/telemetry.mjs';
import { identityContractSupported } from './identity/nativeSupport.mjs';
import { startCharacterEditor } from './characters/editorServer.mjs';
import { defaultControlEndpointPath } from './control/endpointFile.mjs';
import { characterContractSupported } from './characters/nativeSupport.mjs';
import { IntelligenceClient } from './perception/intelligenceClient.mjs';
import { loadRadioTrackTextCatalog } from './perception/radioTrackTextCatalog.mjs';
import {DirectorObservationPump} from './perception/directorProduction.mjs';
import {directorSpeechLimitsForPreset} from './perception/sceneDirector.mjs';
import {DirectorSpeechReservations} from './perception/sceneDirectorAdmission.mjs';
import {SceneDirectorSpeech} from './perception/sceneDirectorOrchestrator.mjs';
import { ActivityClient } from './activities/activityClient.mjs';
import { ActivityRuntime } from './activities/activityRuntime.mjs';
import { perceptionContractSupported } from './perception/nativeSupport.mjs';
import { createDialogueTrace, createNoopDialogueTrace } from './observability/dialogueTrace.mjs';
import {createM3ProductionMemory} from './memory/m3ProductionMemory.mjs';
import {createMemoryD02Port} from './memory/memoryD02Port.mjs';
import {resolveMemoryKCapabilities} from './memory/capabilityPolicy.mjs';

const shutdownClosers = new Set();
let shutdownFlushRegistered = false;

export async function createRuntimeForBundle(options = {}) {
  // Explicit test/embedding environments remain isolated from local secrets.
  const env = options.env !== undefined && options.envFilePath === undefined
    ? options.env
    : await loadPrivateEnvironment(options);
  let config = await loadConfig({ ...options, env });
  if (config.persistentIdentity.enabled) {
    let contract = options.identityContract;
    if (contract === undefined) {
      try { contract = JSON.parse(await readFile(new URL('../build-manifest.json', import.meta.url), 'utf8')).identityContract; } catch {}
    }
    if (!identityContractSupported(contract)) {
      config = Object.freeze({ ...config, persistentIdentity: Object.freeze({ ...config.persistentIdentity, enabled: false }) });
      try { console.warn('[P1] Persistence disabled (optional_identity_contract_unavailable).'); } catch {}
    }
  }
  if (config.promotedCharacters.enabled) {
    let contract = options.characterContract;
    if (contract === undefined) try { contract = JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).characterContract; } catch {}
    config = Object.freeze({ ...config,promotedCharacters:Object.freeze({ ...config.promotedCharacters,nativeSupported:characterContractSupported(contract) }) });
  }
  let telemetry = options.telemetry;
  if (!telemetry) {
    const entry = path.basename(process.argv[1] || '');
    const enabled = options.enableTelemetry === true || (!Object.hasOwn(options, 'enableTelemetry') && entry === 'server.bundle.mjs');
    if (enabled && config.observabilityEnabled) {
      try {
        let manifest = {};
        try { manifest = JSON.parse(await readFile(path.resolve(process.cwd(), 'build-manifest.json'), 'utf8')); } catch {}
        const sink = await createFileSink({
          directory: options.telemetryDirectory || path.resolve(process.cwd(), 'logs'),
          maxFileBytes: config.observabilityMaxFileBytes,
          maxTotalBytes: config.observabilityMaxTotalBytes,
          maxFiles: config.observabilityMaxFiles,
          onFailure: ({ code }) => { try { console.warn(`[E1 telemetry] persistent logging disabled (${code}).`); } catch {} },
        });
        telemetry = new Telemetry({ sink, run: {
          provider: config.provider, model: config.reasoningModel, nodeVersion: process.version,
          parentPid: process.ppid, bundleHash: options.bundleHash, dllHash: options.dllHash,
          providerWorkDeadlineMs: config.providerWorkDeadlineMs, playbackCompletionMaxMs: config.playbackCompletionMaxMs,
          credentialAvailable: Boolean(config.reasoningKey || config.transcriptionKey || config.ttsKey),
          bundleHash: manifest.builtBundleSha256, dllHash: manifest.nativeContract?.dllSha256,
        } });
        shutdownClosers.add(telemetry);
      } catch (error) {
        try { console.warn(`[E1 telemetry] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
        telemetry = createNoopTelemetry();
      }
    } else telemetry = createNoopTelemetry();
  }
  let dialogueTrace = options.dialogueTrace || createNoopDialogueTrace();
  if (!options.dialogueTrace && config.provider === 'openai' && config.dialogueLogging.enabled) {
    try {
      const sink = await createFileSink({
        directory: options.dialogueDirectory || path.resolve(process.cwd(), 'logs', 'dialogue'),
        maxFileBytes: config.dialogueLogging.maxFileBytes,
        maxTotalBytes: config.dialogueLogging.maxTotalBytes,
        maxFiles: config.dialogueLogging.maxFiles,
        onFailure: ({ code }) => { try { console.warn(`[E1 dialogue] persistent logging disabled (${code}).`); } catch {} },
      });
      dialogueTrace = createDialogueTrace({ sink, telemetryRunId: telemetry?.runId || null, config: config.dialogueLogging,
        secrets: [config.reasoningKey, config.transcriptionKey, config.ttsKey] });
      shutdownClosers.add(dialogueTrace);
    } catch (error) {
      try { console.warn(`[E1 dialogue] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
      dialogueTrace = createNoopDialogueTrace();
    }
  }
  if (!shutdownFlushRegistered) {
    shutdownFlushRegistered = true;
    process.once('beforeExit', async () => { for (const closer of shutdownClosers) await closer.close().catch(() => {}); });
  }
  // The existing host starts before the authenticated native pipe. Keep a
  // single source-fenced read-through authority; absence must stay unknown.
  let connectedMemoryAuthority=null;
  const memoryAuthorityPort=Object.freeze({
    verifyCurrentTurn:x=>connectedMemoryAuthority?.verifyCurrentTurn(x)??null,
    resolveNativeOwner:x=>connectedMemoryAuthority?.resolveNativeOwner(x)??null,
    resolveParticipants:x=>connectedMemoryAuthority?.resolveParticipants(x)??null,
    resolvePrepromotion:x=>connectedMemoryAuthority?.resolvePrepromotion(x)??null,
    verifyNativeCoverage:x=>connectedMemoryAuthority?.verifyNativeCoverage(x)??null
  });
  const runtime = createRuntime(config, { ...options,
    memoryNativeAuthority:options.memoryNativeAuthority??memoryAuthorityPort,
    telemetry, dialogueTrace });
  let capabilityManifest=null,capabilityPayloadHash=null,capabilityValidation=Object.freeze([]);
  try {const bytes=await readFile(new URL('../build-manifest.json',import.meta.url));capabilityManifest=JSON.parse(bytes);capabilityPayloadHash=createHash('sha256').update(bytes).digest('hex');}catch{}
  capabilityValidation=await loadCapabilityValidation(options.capabilityValidationPath??path.resolve(process.cwd(),'diagnostics/validation.v1.json'));
  runtime.services.capabilityHealth=()=>projectCapabilityHealth({config,manifest:capabilityManifest,payloadHash:capabilityPayloadHash,validation:capabilityValidation,perception:runtime.intelligence?.runtime,activities:runtime.activities});
  // Workstream B read model. Construction/registration does not establish that
  // a source is fresh, P2 has a healthy writer, D02 has a current owner, or
  // that optional capture was turned on/off. No probe calls mutate authority.
  runtime.services.memoryKDiagnostics=()=>{
    const store=runtime.characterService?.store;
    const source=runtime.intelligence?.runtime;
    const registered={
      'source.core':!!runtime.intelligence && !!source,
      'p2.sqlite':config.promotedCharacters.storageMode==='sqlite' &&
        runtime.characterService?.ready===true &&
        typeof store?.withP2SqliteTransaction==='function',
      'authority.d02':!!runtime.memoryD02,
      // M3 owns its distinct authenticated witness-authority port. A supplied
      // test authority is only a registered seam, never production proof.
      'authority.witness':!!runtime.memoryM3 &&
        (!!connectedMemoryAuthority || typeof options.memoryNativeAuthority?.resolveNativeOwner==='function'),
      'ps4.assembler':typeof runtime.services.finalizeKnowledgeFrame==='function',
      // Code presence != verified suppression / privacy enforcement.
      'privacy.core':config.promotedCharacters.storageMode==='sqlite' &&
        typeof store?.withP2SqliteRead==='function',
      'ps1.producers':!!runtime.intelligence,
      'ps2.observations':!!runtime.intelligence,
      'ps3.salience':!!source?.salience,
      'ps4.perceived':runtime.dialogueKnowledgeBuildSupported===true,
      'ps6.speech':!!runtime.director,
      'memory.dialogue.player':typeof runtime.services.bindM2Turn==='function' &&
        !!runtime.memoryD02,
      'memory.dialogue.npc':typeof runtime.services.recordM2Npc==='function' &&
        !!runtime.memoryD02,
      'memory.events':!!runtime.memoryM3,
      'memory.coverage':!!runtime.memoryM3,
      'memory.journalContext':typeof runtime.services.prepareLiveTurnMemory==='function',
      'memory.recall':typeof runtime.services.prepareLiveTurnMemory==='function',
      'memory.commands':typeof runtime.services.prepareLiveTurnMemory==='function',
      'memory.interpretation':typeof runtime.services.prepareLiveTurnMemory==='function',
    };
    const environment=Object.freeze({
      source:Object.freeze({
        registered:registered['source.core'], hostContextObserved:!!source?.hostContext,
        freshness:'unverified',
      }),
      storage:Object.freeze({
        registered:registered['p2.sqlite'],initialized:runtime.characterService?.ready===true,
        // Snapshot only: not a transaction or integrity/owner receipt.
        timelineWritableSnapshot:store?.timelineWritable===true,
        timelineConfirmation:'unverified',writerHealth:'unverified',
      }),
      native:Object.freeze({
        d02Registered:registered['authority.d02'],currentOwnerProof:'unverified',
        m3WitnessAuthorityRegistered:registered['authority.witness'],m3WitnessProof:'unverified',
      }),
      ps4:Object.freeze({assemblerRegistered:registered['ps4.assembler'],soleWriterAdmission:'unverified'}),
      privacy:Object.freeze({
        portRegistered:registered['privacy.core'],enforcement:'unverified',
      }),
      capture:Object.freeze({
        m3AdapterRegistered:registered['memory.events'],
        acceptedObservationObserved:'unverified',
        dialoguePersisted:'unverified',
      }),
      // No persisted-consent read, idle proof or worker admission is performed.
      cloud:Object.freeze({
        workerRegistered:false,consent:'unverified',budget:'unverified',idle:'unverified',
      }),
    });
    return Object.freeze({capabilities:resolveMemoryKCapabilities({config,available:registered}),environment});
  };
  runtime.services.memoryKCapabilities=()=>runtime.services.memoryKDiagnostics().capabilities;
  let knowledgeContract=options.dialogueKnowledgeContract,knowledgePerceptionContract=options.perceptionContract;
  if(knowledgeContract===undefined)knowledgeContract=capabilityManifest?.dialogueKnowledgeContract;
  if(knowledgePerceptionContract===undefined)knowledgePerceptionContract=capabilityManifest?.perceptionContract;
  runtime.dialogueKnowledgeBuildSupported=dialogueKnowledgeContractSupported(knowledgeContract,knowledgePerceptionContract);
  if(config.intelligence.mode==='shadow') {
    let contract=options.perceptionContract;
    if(contract===undefined) try {contract=JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).perceptionContract;}catch{}
    if(perceptionContractSupported(contract)) {
      try {
        const suppliedIntelligenceTelemetry=options.intelligenceOptions?.telemetry;
        // Radio remains optional and never supplies a second model prompt writer.
        let radioCatalog=options.intelligenceOptions?.radioCatalog;
        if(radioCatalog===undefined && config.intelligence.radio==='shadow') {
          try {radioCatalog=loadRadioTrackTextCatalog(await readFile(new URL('../data/radioTrackTextIds.v2.json',import.meta.url),'utf8'));} catch {}
        }
        let memoryIntake=null;
        let currentOwnerPlayerAuthority=null;
        const memoryStore=runtime.characterService?.store;
        const memoryNative=options.memoryNativeAuthority??memoryAuthorityPort;
        const canBindMemory=config.promotedCharacters.storageMode==='sqlite' &&
          typeof memoryStore?.withTimelineWrite==='function' &&
          typeof memoryNative?.resolveNativeOwner==='function';
        // Strict synchronous verified PS2 tap; never execute SQLite here.
        const memoryObservationTap=receipt=>memoryIntake?.acceptedObservationTap(receipt) ??
          {accepted:false,reason:'m3_owner_ledger_unavailable'};
        const intelligenceOptions={radioCatalog,situationFor:ref=>runtime.situationFor(ref),
          directorProductionRequired:config.spontaneousSpeech.mode==='experimental',
          // Original stock A turn/mic/output stores; every missing bridge or
          // source read fails closed before native Director reserve/submit.
          originalTurnPriority:()=>{try{return runtime.host.directorTurnPrioritySnapshot();}catch{return null;}},
          originalTurnReserve:ticket=>{try{return runtime.host.directorReserveOriginalTurn(ticket);}catch{return null;}},
          originalTurnCurrent:ticket=>{try{return runtime.host.directorCheckOriginalTurn(ticket);}catch{return null;}},
          originalTurnRelease:ticket=>{try{return runtime.host.directorReleaseOriginalTurn(ticket);}catch{return false;}},
          originalTurnPhase:ticket=>{try{return runtime.host.directorOriginalPhase(ticket);}catch{return null;}},
          ...options.intelligenceOptions,
           acceptedObservationTap:canBindMemory?memoryObservationTap:null,
           telemetry:(event,data)=>{
          try { suppliedIntelligenceTelemetry?.(event,data); } catch {}
          try { telemetry?.emit?.(event,null,'internal',data,'internal'); } catch {}
        }};
        runtime.intelligence=new IntelligenceClient(config.intelligence,intelligenceOptions);
        // Independently authenticated D02 owner/controlled-player source.
        // Exposes only the synchronous read-through lease/verification port;
        // neither this port nor the native frame attests accepted dialogue.
        if(canBindMemory && !options.memoryNativeAuthority) {
          try {
            currentOwnerPlayerAuthority=createMemoryD02Port({
              intelligence:runtime.intelligence,memoryStore});
            runtime.memoryD02=currentOwnerPlayerAuthority.port;
            shutdownClosers.add({close:async()=>currentOwnerPlayerAuthority?.close()});
          }catch{currentOwnerPlayerAuthority=null;}
        }
        // D01 OpenAI acceptance receipts never outlive a verified host run or
        // world epoch: any change retires the current acceptance source run.
        if(canBindMemory){
          let acceptanceEpoch=null;
          runtime.intelligence.subscribeVerifiedHostContext(host=>{
            const stamp=host?host.hostRunId+':'+host.worldEpoch:null;
            if(stamp!==acceptanceEpoch){
              if(acceptanceEpoch!==null)runtime.retireOriginalAcceptanceSourceRun?.();
              acceptanceEpoch=stamp;
            }
          });
          runtime.intelligence.subscribeWorldBoundary(()=>{runtime.retireOriginalAcceptanceSourceRun?.();});
        }
        // One genuine authenticated ledger for M2/M3 plus the M3 PS2 intake, built
        // by the shared factory the integration tests also use. Normal production
        // never trusts a caller-supplied nativeVerified flag or model-generated
        // owner claim; an explicit test-only injected authority stays isolated.
        if(canBindMemory){
          try{
            const m3=createM3ProductionMemory({intelligence:runtime.intelligence,memoryStore,
              nativeAuthority:options.memoryNativeAuthority??null,telemetry});
            memoryIntake=m3.adapter;
            connectedMemoryAuthority=m3.authority;
            runtime.memoryM3=Object.freeze({snapshot:()=>m3.snapshot(),
              close:()=>m3.adapter.close(),shutdown:()=>m3.close()});
            shutdownClosers.add({close:()=>m3.close()});
          }catch{memoryIntake=null;connectedMemoryAuthority=null;try{console.warn('[M3] verified_owner_binder_unavailable');}catch{}}
        }
        if(config.promotedCharacters.storageMode==='sqlite' && runtime.characterService?.store?.onBoundary) {
          runtime.intelligence.subscribeVerifiedHostContext(context=>{
            try {runtime.characterService.store.setVerifiedHostContext(context);}
            catch {runtime.characterService.emit('character_safe_failure',{reason:'timeline_write_suspended'});}
          });
          // Receive only post-validation C-13 native world epochs. No inference
          // from a model turn, OS clock, gameplay timestamp or stale channel.
          runtime.intelligence.subscribeWorldBoundary(boundary=>{
            try {runtime.characterService.store.onBoundary({reason:boundary.reason});}
            catch {runtime.characterService.emit('character_safe_failure',{reason:'timeline_write_suspended'});}
          });
        }
        runtime.intelligence.start();
      }catch{try{console.warn('[PS] optional_channel_unavailable');}catch{}}
    } else try {console.warn('[PS] optional_perception_contract_unavailable');}catch{}
  }

  // Production coordinator: original Core kb is still the only scheduler.
  // The native add-on must independently opt in and source-pin each C-06 gate.
  if(config.spontaneousSpeech.mode!=='off' && runtime.intelligence) {
    const client=runtime.intelligence;
    const now=()=>client.runtime.now();
    const experimental=config.spontaneousSpeech.mode==='experimental';
    const sourceCheck=({proposal,stamp,stage})=>{
      const live=client.runtime,owner=live.directorOwnerProofFor(proposal.speakerCaptureRef);
      const priority=live.directorPriority,at=now();
      if(!owner || !priority || !priority.experimentalEnabled ||
         !Number.isSafeInteger(at) || at-priority.receivedAt>1500 ||
         at<priority.receivedAt ||
         owner.hostRunId!==stamp.hostRunId ||
         owner.worldEpoch!==stamp.worldEpoch ||
         owner.ownerIncarnationId!==stamp.ownerIncarnationId ||
         owner.proofRevision!==stamp.proofRevision ||
         priority.hostRunId!==stamp.hostRunId ||
         priority.worldEpoch!==stamp.worldEpoch ||
         priority.playerTurnVersion!==stamp.playerTurnVersion ||
         !live.current(proposal.playerCaptureRef))return false;
      // PS3 grants expire during ordinary TTS; native verifies the original
      // bound Core tuple and current player-priority epoch at playback end.
      if(stage==='complete')return true;
      return client.directorOriginalEntitlement(proposal,stamp)?.source===
        'original_companion_ps2_ps3';
    };
    const admission=new DirectorSpeechReservations({
      now,enabled:experimental,checkCurrent:sourceCheck,
      limits:directorSpeechLimitsForPreset(config.spontaneousSpeech.preset),
      acknowledge:(decisionKey,consumer,outcome,proposal)=>
        consumer==='ps6_ticket' && outcome==='delivered' && proposal?.decisionKey===decisionKey
          ? client.runtime.salience.acknowledgeDirectorCompletion(proposal,client.runtime.epoch)
          : false,
    });
    const coordinator=new SceneDirectorSpeech({
      admission,now,mode:experimental?'active':'shadow',
      originalEntitlement:(proposal,stamp)=>client.directorOriginalEntitlement(proposal,stamp),
      nativeRequest:r=>client.requestDirector(r),
      dispatch:r=>client.dispatchDirector(r),
    });
    let pump;
    pump=new DirectorObservationPump({client,coordinator,now,
      stampFor:proposal=>pump.currentStamp(proposal),
      onDiagnostic:result=>{
        try {telemetry?.emit?.('director_gate',null,'internal',{
          reason:result.reason,configuredMode:config.spontaneousSpeech.mode,
          nativeExperimental:client.runtime.directorPriority?.experimentalEnabled===true,
        },'internal');}catch{}
      },
      onResult:outcome=>{
        try {telemetry?.emit?.('director_candidate',null,'internal',{
          status:outcome?.status??'unknown',nativeReason:outcome?.nativeReason,
          diagnosticReason:outcome?.diagnosticReason??null,
          configuredMode:config.spontaneousSpeech.mode,
          executionAvailable:experimental &&
            client.runtime.directorPriority?.experimentalEnabled===true,
        },'internal');}catch{}
      },
    });
    runtime.director=pump;
    runtime.services.spontaneousSpeechStatus=()=>Object.freeze({
      requested:config.spontaneousSpeech.mode,
      preset:config.spontaneousSpeech.preset,
      routineSpeakerCooldownMs:admission.limits.routineSpeakerCooldownMs,
      urgentSpeakerCooldownMs:admission.limits.urgentSpeakerCooldownMs,
      sceneGapMs:admission.limits.sceneGapMs,
      attemptsPerMinute:admission.limits.attemptsPerMinute,
      executionAvailable:experimental &&
        client.runtime.directorPriority?.experimentalEnabled===true &&
        client.runtime.directorRequestVersion===1,
      reason:experimental?'native_opt_in_and_live_C06_required':'shadow_only',
    });
    client.subscribeKnowledgeInvalidation(()=>{void pump.tick();});
  }
  // Orderly shutdown revokes any still-pending OpenAI acceptance receipts.
  shutdownClosers.add({close:async()=>{runtime.retireOriginalAcceptanceSourceRun?.();}});
  runtime.services.acceptPlayerTranscript = input => runtime.intelligence?.acceptPlayerTranscript(input) ?? {accepted:false,reason:'unsupported_capture_receipt'};
  runtime.services.projectTurnContext = input => runtime.intelligence?.projectTurnContext(input) ?? null;
  runtime.services.acknowledgeTurnContext = (projection,outcome='delivered') => runtime.intelligence?.acknowledgeTurnContext(projection,outcome) ?? false;
  if(config.activities.mode==='shadow' || config.activities.mode==='on') {
    try {
      const notifyKnowledge=()=>{try{runtime.intelligence?.notifyKnowledgeInvalidation();}catch{}};
      const onEvent = (event, data) => { try { telemetry?.emit?.(event, null, 'system', data); } catch {} notifyKnowledge(); };
      const onFrame=frame=>{try{options.activityOptions?.onFrame?.(frame);}catch{}notifyKnowledge();};
      runtime.activities = config.activities.mode === 'on'
        ? new ActivityRuntime(config.activities, { ...options.activityOptions, onEvent,onFrame })
        : new ActivityClient(config.activities, { ...options.activityOptions, onEvent,onFrame });
      runtime.activities.start();
      runtime.characterService?.bindActivities?.(runtime.activities);
    } catch { try { console.warn('[ACT] optional_channel_unavailable'); } catch {} }
  }
  if (runtime.characterService) {
    // Opt-in SQLite writer must release its explicit cross-host lock at orderly shutdown.
    // No JSON default store or native effect ownership is changed.
    if (config.promotedCharacters.storageMode === 'sqlite')
      shutdownClosers.add({ close: () => runtime.characterService.closeStorage() });
    await runtime.characterService.initialize();
    if (runtime.characterService.ready && options.startCharacterEditor !== false) try {
      // Per-user endpoint file for the native console bridge; null disables it.
      // The resolved environment keeps explicit test/embedding envs isolated.
      const endpointPath = options.controlEndpointPath !== undefined ? options.controlEndpointPath : defaultControlEndpointPath({ env });
      runtime.characterEditor = await startCharacterEditor(runtime.characterService,{ endpointPath });
      try { console.info('[P2] Character editor: ' + runtime.characterEditor.url); } catch {}
      if (endpointPath && !runtime.characterEditor.endpointPublished) try { console.warn('[UX] Control endpoint file unavailable; native clients use the page handshake.'); } catch {}
    } catch { runtime.characterService.emit('character_safe_failure',{reason:'owner_unavailable'}); }
  }
  return runtime;
}
