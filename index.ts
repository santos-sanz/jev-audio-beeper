import { noul, score, TypeSafeClient } from '@typesafe-ai/sdk';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

type Word = { word: string; startMs: number; endMs: number };
const threshold = 0.72, paddingMs = 55;
const [input, transcriptPath, output = 'censored.wav'] = process.argv.slice(2);
if (!input || !transcriptPath) throw new Error('Usage: npx tsx index.ts input.wav words.json [output.wav]');
const transcript = JSON.parse(await readFile(transcriptPath, 'utf8')) as { words: Word[] };
const client = new TypeSafeClient();
const state = { language: 'es', words: transcript.words.map((w,i,a)=>({token:w.word,localContext:a.slice(Math.max(0,i-2),i+3).map(x=>x.word).join(' ')})) };
const questions = Object.fromEntries(transcript.words.flatMap((_,i)=>[
  [`insult_${i}`, noul(`Evalúa solo words[${i}].token en contexto. ¿Es una grosería que taparías en audio apto para todo público?`, {true:'pitido',false:'conservar'})],
  [`severity_${i}`, score(`Severidad audible de words[${i}].token.`, ['inocuo','dudoso','grosero','insulto fuerte'])]
]));
const t=performance.now(); const response=await client.systemOne({model:'jev-latest',state,questions}); const latencyMs=Math.round(performance.now()-t);
const hits=transcript.words.filter((_,i)=>(response.answers[`insult_${i}`] as {noul:number}).noul>=threshold);
const intervals=hits.map(w=>({startMs:Math.max(0,w.startMs-paddingMs),endMs:w.endMs+paddingMs}));
const enabled=intervals.map(x=>`between(t,${x.startMs/1000},${x.endMs/1000})`).join('+')||'0';
await new Promise<void>((ok,fail)=>spawn('ffmpeg',['-y','-i',input,'-filter_complex',`[0:a]volume='if(${enabled},0,1)'[c];sine=frequency=1000:sample_rate=48000,volume='if(${enabled},0.32,0)'[b];[c][b]amix=inputs=2:duration=first:normalize=0[o]`,'-map','[o]','-c:a','pcm_s16le',output],{stdio:'inherit'}).on('exit',c=>c===0?ok():fail(new Error(`ffmpeg ${c}`))));
const report={model:response.model,latencyMs,threshold,answers:response.answers,intervals}; await writeFile(`${output}.json`,JSON.stringify(report,null,2)); console.log(report);
