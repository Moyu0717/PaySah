import * as THREE from 'three';
export interface SceneState{step:number;amount:string;bank:string;blocked:boolean}
export interface StoryScene{update:(state:SceneState)=>void;dispose:()=>void}
export function createScene(host:HTMLElement,onLost:()=>void):StoryScene{
 const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0,0);renderer.domElement.setAttribute('aria-hidden','true');host.append(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,50);camera.position.set(0,0,12);
 const group=new THREE.Group();scene.add(group);
 const geometry=new THREE.BoxGeometry(2.65,3.5,.07),textures:THREE.CanvasTexture[]=[],materials:THREE.MeshBasicMaterial[]=[],cards:THREE.Mesh[]=[];
 const canvases:HTMLCanvasElement[]=[];
 for(let i=0;i<3;i++){const canvas=document.createElement('canvas');canvas.width=540;canvas.height=710;canvases.push(canvas);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.push(texture);const material=new THREE.MeshBasicMaterial({map:texture});materials.push(material);const card=new THREE.Mesh(geometry,material);group.add(card);cards.push(card);}
 let state:SceneState={step:0,amount:'RM 45.00',bank:'RM 45.00',blocked:false},frame=0,disposed=false,visible=true,px=0,py=0;
 function paint(){canvases.forEach((canvas,i)=>{const ctx=canvas.getContext('2d')!;ctx.fillStyle=['#fff9fd','#e3dcff',state.blocked?'#ffe5df':'#dcf4e8'][i];ctx.fillRect(0,0,540,710);ctx.fillStyle='#5b447a';ctx.font='bold 22px sans-serif';ctx.fillText(['01 / RECEIPT','02 / ORDER','03 / BANK CREDIT'][i],44,65);ctx.fillStyle='#35244e';ctx.font='bold 52px sans-serif';ctx.fillText(i===2?state.bank:state.amount,44,195);ctx.font='24px sans-serif';ctx.fillText(['Claimed transfer','Amount due / MYR',state.blocked?'Evidence mismatch':'Booked / synthetic'][i],44,248);ctx.fillStyle='#d5c9e7';for(let j=0;j<5;j++)ctx.fillRect(44,315+j*42,420-j%2*65,9);ctx.fillStyle='#5b447a';ctx.font='20px sans-serif';ctx.fillText('PAYSAH / SYNTHETIC STORY',44,645);textures[i].needsUpdate=true;});}
 function render(){frame=0;if(disposed||!visible||document.hidden)return;const spread=state.step<2?.75:1;cards.forEach((card,i)=>{card.position.set((i-1)*2.9*spread,i===1?.5:-.25,i===0?.5:0);card.rotation.set(i===1?-.07:.05,(i-1)*-.12,(i-1)*-.07);card.scale.setScalar(state.step===0&&i>0?.78:1);});group.rotation.set(py*.04,px*.05,0);group.position.y=state.step===1?.15:0;renderer.render(scene,camera);}
 function schedule(){if(!frame&&!disposed&&visible&&!document.hidden)frame=requestAnimationFrame(render);}
 function resize(){const rect=host.getBoundingClientRect();renderer.setSize(Math.max(rect.width,1),Math.max(rect.height,1));camera.aspect=Math.max(rect.width,1)/Math.max(rect.height,1);camera.position.z=rect.width<500?11.5:9.5;camera.updateProjectionMatrix();schedule();}
 function pointer(e:PointerEvent){if(!matchMedia('(pointer:fine)').matches)return;const r=host.getBoundingClientRect();px=(e.clientX-r.left)/r.width-.5;py=(e.clientY-r.top)/r.height-.5;schedule();}
 function leave(){px=py=0;schedule();}
 function visibility(){if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}else schedule();}
 function lost(e:Event){e.preventDefault();onLost();}
 const resizeObserver=new ResizeObserver(resize),intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else schedule();});resizeObserver.observe(host);intersection.observe(host);
 host.addEventListener('pointermove',pointer);host.addEventListener('pointerleave',leave);renderer.domElement.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',visibility);paint();resize();
 return {update(next){state=next;paint();schedule();},dispose(){if(disposed)return;disposed=true;if(frame)cancelAnimationFrame(frame);resizeObserver.disconnect();intersection.disconnect();host.removeEventListener('pointermove',pointer);host.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',visibility);renderer.domElement.removeEventListener('webglcontextlost',lost);geometry.dispose();textures.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
