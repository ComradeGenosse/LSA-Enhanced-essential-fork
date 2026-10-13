// Deterministic OFFLINE ElevenLabs fake, shared by emotional delivery tests.
// The actual production speech provider mints the private applied-result brand;
// fixtures cannot forge it with {tagApplied:true} JSON.
import { createElevenLabsSpeechProvider } from '../../src/providers/elevenlabs/speechProvider.mjs';
import { renderElevenSpeech } from '../../src/voice/emotion/elevenTags.mjs';
const voiceId = 'JBFqnCBsd6RMkjVDRZzb';
export async function emitTagged({
  identity,delivery,dialogue='Hello, friend.',mode='experimental',
  modelId='eleven_v4_turbo',signal,onPcm=async()=>{},messages=null,
}={}) {
  const sockets=[];
  class FakeWS {
    constructor(url) {
      this.url=url;this.frames=[];this.events=new Map();this.closed=false;
      sockets.push(this);queueMicrotask(()=>this.emit('open',{}));
    }
    addEventListener(type,fn) {
      this.events.set(type,[...(this.events.get(type)||[]),fn]);
    }
    emit(type,value) {for(const f of this.events.get(type)||[])f(value);}
    send(json) {
      const frame=JSON.parse(json);this.frames.push(frame);
      if(frame.close_socket) queueMicrotask(()=>{
        for(const data of messages??[
          {audio:Buffer.alloc(2400,0x19).toString('base64')},{is_final:true},
        ]) this.emit('message',{data:JSON.stringify(data)});
      });
    }
    close() {this.closed=true;}
  }
  const provider=createElevenLabsSpeechProvider({
    config:{speechProvider:'elevenlabs',speechVoices:['nathan'],
      ttsVoice:'nathan',elevenLabs:{modelId,voices:{nathan:voiceId},apiKey:'FAKE-KEY'},
      expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:2}},
    WebSocketImpl:FakeWS,renderSpeech:renderElevenSpeech,
  });
  const result=await provider.synthesize({identity,dialogue,delivery,signal,onPcm});
  return {result,sockets};
}
