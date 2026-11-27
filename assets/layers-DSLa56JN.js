import{n as e}from"./rolldown-runtime-XKyaHtl9.js";import{u as t,v as n}from"./media-NZmTmA5T.js";import{i as r,t as i}from"./jobs-13sp0Z_z.js";import{o as a,t as o}from"./hardware-DBvaZWCb.js";import{t as s}from"./db-DZhDqWKy.js";var c=`
import { pipeline, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
env.allowLocalModels = false;
${o}
const pipes = {}, devices = {};
async function get(task) {
  if (pipes[task]) return pipes[task];
  let device = 'wasm';
  if (await gpuPick()) device = 'webgpu';
  const prog = (p) => { if (p.status === 'progress') self.postMessage({ type: 'load', task, p: (p.progress || 0) / 100 }); };
  // on the graphics card: fp16 when it has it (q8 is a processor format, slow on a card); refused → processor
  let f16 = false;
  try { const a = device === 'webgpu' && await navigator.gpu.requestAdapter(); f16 = !!a && a.features.has('shader-f16'); } catch {}
  const make = (dev) => task === 'depth'
    ? pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: dev, dtype: dev === 'webgpu' ? (f16 ? 'fp16' : 'fp32') : 'q8', progress_callback: prog })
    : pipeline('background-removal', 'onnx-community/BiRefNet_lite-ONNX', { device: dev, dtype: dev === 'webgpu' ? (f16 ? 'fp16' : 'fp32') : 'fp32', progress_callback: prog });
  try { pipes[task] = await make(device); } catch (e) { if (device !== 'webgpu') throw e; device = 'wasm'; pipes[task] = await make('wasm'); }
  devices[task] = device;
  return pipes[task];
}
self.onmessage = async (ev) => {
  const { id, task, blob } = ev.data;
  try {
    const p = await get(task);
    const img = await RawImage.fromBlob(blob);
    if (task === 'depth') {
      const out = await p(img);
      const d = out.depth;
      self.postMessage({ id, type: 'done', width: d.width, height: d.height, data: d.data, device: devices[task] }, [d.data.buffer]);
    } else {
      const out = await p(img);
      const r = Array.isArray(out) ? out[0] : out;
      const rgba = r.channels === 4 ? r : r.rgba();
      self.postMessage({ id, type: 'done', width: rgba.width, height: rgba.height, data: rgba.data, device: devices[task] }, [rgba.data.buffer]);
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`,l=null,u=0;r(`vision`,()=>{l?.terminate(),l=null});function d(e,t,n){return i(`vision`,()=>f(e,t,n))}function f(e,t,n){l??=new Worker(URL.createObjectURL(new Blob([c],{type:`text/javascript`})),{type:`module`});let r=++u;return new Promise((i,o)=>{let s=l,c=t=>{let l=t.data;l.type===`load`&&l.task===e&&n?.(l.p),l.id===r&&(s.removeEventListener(`message`,c),l.type===`error`?o(Error(l.message)):(l.device&&a(e===`depth`?`Relief 2.5D (profondeur)`:`Détourage`,l.device),i(l)))};s.addEventListener(`message`,c),s.postMessage({id:r,task:e,blob:t})})}var p=e=>new Promise(t=>e.toBlob(e=>t(e),`image/jpeg`,.9));async function m(e,t,n){let r=document.createElement(`canvas`),i=Math.min(1,518/Math.max(t.w,t.h));r.width=Math.round(t.w*i),r.height=Math.round(t.h*i),r.getContext(`2d`).drawImage(e,t.x,t.y,t.w,t.h,0,0,r.width,r.height);let a=await d(`depth`,await p(r),n),o=document.createElement(`canvas`);o.width=a.width,o.height=a.height;let s=o.getContext(`2d`),c=s.createImageData(a.width,a.height);for(let e=0;e<a.width*a.height;e++){let t=a.data[e];c.data[e*4]=c.data[e*4+1]=c.data[e*4+2]=t,c.data[e*4+3]=255}return s.putImageData(c,0,0),o}async function h(e,t,n){let r=document.createElement(`canvas`),i=Math.min(1,1024/Math.max(t.w,t.h));r.width=Math.round(t.w*i),r.height=Math.round(t.h*i),r.getContext(`2d`).drawImage(e,t.x,t.y,t.w,t.h,0,0,r.width,r.height);let a=await d(`cutout`,await p(r),n),o=document.createElement(`canvas`);return o.width=a.width,o.height=a.height,o.getContext(`2d`).putImageData(new ImageData(new Uint8ClampedArray(a.data),a.width,a.height),0,0),o}async function g(){try{return!!navigator.gpu&&!!await navigator.gpu.requestAdapter()}catch{return!1}}var _=e({ensureLayers:()=>x}),v=new Map,y=(e,t)=>`${e}:${Math.round(t.x)}:${Math.round(t.y)}:${Math.round(t.w)}:${Math.round(t.h)}`;function b(e,t){let n=e.pages.find(e=>e.id===t.pageId);if(!n)return null;let r=v.get(y(n.mediaId,t.rect));return r&&r!==`pending`&&r!==`none`?r:null}async function x(e,r,i){let a=e.pages.find(e=>e.id===r.pageId),o=a&&t(a.mediaId);if(!a||!o)return;let s=y(a.mediaId,r.rect);if(!v.has(s)){v.set(s,`pending`);try{let e=await S(s)??await m(o.img,r.rect,i).then(e=>(e&&C(s,e),e));if(!e){v.set(s,`none`);return}let t=w(o.img,r.rect,e);v.set(s,t??`none`),t&&n()}catch{v.set(s,`none`)}}}async function S(e){try{let t=await s.get(`media`,`depth:`+e);if(!t)return null;let n=await createImageBitmap(t),r=document.createElement(`canvas`);return r.width=n.width,r.height=n.height,r.getContext(`2d`).drawImage(n,0,0),n.close(),r}catch{return null}}async function C(e,t){try{let n=await new Promise(e=>t.toBlob(e,`image/png`));n&&await s.put(`media`,`depth:`+e,n)}catch{}}function w(e,t,n){let r=Math.min(1,1200/Math.max(t.w,t.h)),i=Math.max(8,Math.round(t.w*r)),a=Math.max(8,Math.round(t.h*r)),o=()=>{let e=document.createElement(`canvas`);return e.width=i,e.height=a,e},s=o(),c=s.getContext(`2d`,{willReadFrequently:!0});c.drawImage(n,0,0,i,a);let l=c.getImageData(0,0,i,a),u=[];for(let e=0;e<i*a;e+=7)u.push(l.data[e*4]);u.sort((e,t)=>e-t);let d=u[Math.floor(u.length*.65)],f=d-12,p=d+12,m=0;for(let e=0;e<i*a;e++){let t=l.data[e*4],n=t<=f?0:t>=p?255:Math.round((t-f)/(p-f)*255);l.data[e*4+3]=n,n>127&&m++}let h=m/(i*a);if(h<.08||h>.7)return null;c.putImageData(l,0,0);let g=o(),_=g.getContext(`2d`);_.filter=`blur(${Math.max(1,i/300)}px)`,_.drawImage(s,0,0);let v=o(),y=v.getContext(`2d`);y.drawImage(e,t.x,t.y,t.w,t.h,0,0,i,a),y.globalCompositeOperation=`destination-in`,y.drawImage(g,0,0);let b=o(),x=b.getContext(`2d`);x.drawImage(e,t.x,t.y,t.w,t.h,0,0,i,a);let S=o(),C=S.getContext(`2d`);C.filter=`blur(${Math.max(4,i/40)}px)`,C.drawImage(g,0,0),C.drawImage(g,0,0);let w=o(),T=w.getContext(`2d`);return T.filter=`blur(${Math.max(8,i/25)}px)`,T.drawImage(e,t.x,t.y,t.w,t.h,-i*.05,-a*.05,i*1.1,a*1.1),T.filter=`none`,T.globalCompositeOperation=`destination-in`,T.drawImage(S,0,0),x.drawImage(w,0,0),{fg:v,bg:b}}export{g as a,h as i,b as n,_ as r,x as t};