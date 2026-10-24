import {useEffect,useRef,useState} from 'react';
import type {StoryScene} from './scene.js';
export function StoryStage({step,amount,bank,blocked,reduced}:{step:number;amount:string;bank:string;blocked:boolean;reduced:boolean}){
 const host=useRef<HTMLDivElement>(null),scene=useRef<StoryScene|null>(null),latest=useRef({step,amount,bank,blocked});latest.current={step,amount,bank,blocked};
 const [mode,setMode]=useState('loading');
 useEffect(()=>{
  if(reduced){setMode('reduced');return;}
  let disposed=false;setMode('loading');
  import('./scene.js').then(({createScene})=>{if(disposed||!host.current)return;try{scene.current=createScene(host.current,()=>setMode('fallback'));scene.current.update(latest.current);setMode('webgl');}catch{setMode('fallback');}}).catch(()=>{if(!disposed)setMode('fallback');});
  return()=>{disposed=true;scene.current?.dispose();scene.current=null;};
 },[reduced]);
 useEffect(()=>{scene.current?.update({step,amount,bank,blocked});},[step,amount,bank,blocked]);
 return <div className="story-stage" data-stage-mode={mode}><div ref={host} className="story-canvas" aria-hidden="true"/>
  <div className={'stage-cards '+(mode==='webgl'?'stage-cards-accessible':'')}><article className="stage-receipt"><span>01 / RECEIPT</span><strong>{amount}</strong><p>Claimed transfer</p><i/><i/><i/><small>A screenshot starts a check.</small></article><article className="stage-order"><span>02 / ORDER</span><strong>{amount}</strong><p>Amount due · MYR</p></article><article className="stage-bank"><span>03 / INDEPENDENT CREDIT</span><strong>{bank}</strong><p>{blocked?'Evidence does not match':'Synthetic booked bank credit'}</p></article></div>
  <p className="stage-caption">{mode==='webgl'?'Interactive 3D illustration':mode==='loading'?'Loading 3D · the complete story is available below':reduced?'Static view · reduced motion':'Static view · 3D unavailable'} · synthetic case</p>
 </div>;
}
