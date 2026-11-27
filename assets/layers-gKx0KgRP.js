import{n as e}from"./rolldown-runtime-XKyaHtl9.js";import{u as t,v as n}from"./media-NZmTmA5T.js";import{i as r,t as i}from"./jobs-13sp0Z_z.js";import{t as a}from"./db-DZhDqWKy.js";var o=`
import { pipeline, RawImage, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
env.allowLocalModels = false;
const pipes = {};
async function get(task) {
  if (pipes[task]) return pipes[task];
  let device = 'wasm';
  try { if (navigator.gpu && await navigator.gpu.requestAdapter()) device = 'webgpu'; } catch {}
  const prog = (p) => { if (p.status === 'progress') self.postMessage({ type: 'load', task, p: (p.progress || 0) / 100 }); };
  pipes[task] = task === 'depth'
    ? await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device, dtype: 'q8', progress_callback: prog })
    : await pipeline('background-removal', 'onnx-community/BiRefNet_lite-ONNX', { device, dtype: device === 'webgpu' ? 'fp16' : 'fp32', progress_callback: prog });
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
      self.postMessage({ id, type: 'done', width: d.width, height: d.height, data: d.data }, [d.data.buffer]);
    } else {
      const out = await p(img);
      const r = Array.isArray(out) ? out[0] : out;
      const rgba = r.channels === 4 ? r : r.rgba();
      self.postMessage({ id, type: 'done', width: rgba.width, height: rgba.height, data: rgba.data }, [rgba.data.buffer]);
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`,s=null,c=0;r(`vision`,()=>{s?.terminate(),s=null});function l(e,t,n){return i(`vision`,()=>u(e,t,n))}function u(e,t,n){s??=new Worker(URL.createObjectURL(new Blob([o],{type:`text/javascript`})),{type:`module`});let r=++c;return new Promise((i,a)=>{let o=s,c=t=>{let s=t.data;s.type===`load`&&s.task===e&&n?.(s.p),s.id===r&&(o.removeEventListener(`message`,c),s.type===`error`?a(Error(s.message)):i(s))};o.addEventListener(`message`,c),o.postMessage({id:r,task:e,blob:t})})}var d=e=>new Promise(t=>e.toBlob(e=>t(e),`image/jpeg`,.9));async function f(e,t,n){let r=document.createElement(`canvas`),i=Math.min(1,518/Math.max(t.w,t.h));r.width=Math.round(t.w*i),r.height=Math.round(t.h*i),r.getContext(`2d`).drawImage(e,t.x,t.y,t.w,t.h,0,0,r.width,r.height);let a=await l(`depth`,await d(r),n),o=document.createElement(`canvas`);o.width=a.width,o.height=a.height;let s=o.getContext(`2d`),c=s.createImageData(a.width,a.height);for(let e=0;e<a.width*a.height;e++){let t=a.data[e];c.data[e*4]=c.data[e*4+1]=c.data[e*4+2]=t,c.data[e*4+3]=255}return s.putImageData(c,0,0),o}async function p(e,t,n){let r=document.createElement(`canvas`),i=Math.min(1,1024/Math.max(t.w,t.h));r.width=Math.round(t.w*i),r.height=Math.round(t.h*i),r.getContext(`2d`).drawImage(e,t.x,t.y,t.w,t.h,0,0,r.width,r.height);let a=await l(`cutout`,await d(r),n),o=document.createElement(`canvas`);return o.width=a.width,o.height=a.height,o.getContext(`2d`).putImageData(new ImageData(new Uint8ClampedArray(a.data),a.width,a.height),0,0),o}async function m(){try{return!!navigator.gpu&&!!await navigator.gpu.requestAdapter()}catch{return!1}}var h=e({ensureLayers:()=>y}),g=new Map,_=(e,t)=>`${e}:${Math.round(t.x)}:${Math.round(t.y)}:${Math.round(t.w)}:${Math.round(t.h)}`;function v(e,t){let n=e.pages.find(e=>e.id===t.pageId);if(!n)return null;let r=g.get(_(n.mediaId,t.rect));return r&&r!==`pending`&&r!==`none`?r:null}async function y(e,r,i){let a=e.pages.find(e=>e.id===r.pageId),o=a&&t(a.mediaId);if(!a||!o)return;let s=_(a.mediaId,r.rect);if(!g.has(s)){g.set(s,`pending`);try{let e=await b(s)??await f(o.img,r.rect,i).then(e=>(e&&x(s,e),e));if(!e){g.set(s,`none`);return}let t=S(o.img,r.rect,e);g.set(s,t??`none`),t&&n()}catch{g.set(s,`none`)}}}async function b(e){try{let t=await a.get(`media`,`depth:`+e);if(!t)return null;let n=await createImageBitmap(t),r=document.createElement(`canvas`);return r.width=n.width,r.height=n.height,r.getContext(`2d`).drawImage(n,0,0),n.close(),r}catch{return null}}async function x(e,t){try{let n=await new Promise(e=>t.toBlob(e,`image/png`));n&&await a.put(`media`,`depth:`+e,n)}catch{}}function S(e,t,n){let r=Math.min(1,1200/Math.max(t.w,t.h)),i=Math.max(8,Math.round(t.w*r)),a=Math.max(8,Math.round(t.h*r)),o=()=>{let e=document.createElement(`canvas`);return e.width=i,e.height=a,e},s=o(),c=s.getContext(`2d`,{willReadFrequently:!0});c.drawImage(n,0,0,i,a);let l=c.getImageData(0,0,i,a),u=[];for(let e=0;e<i*a;e+=7)u.push(l.data[e*4]);u.sort((e,t)=>e-t);let d=u[Math.floor(u.length*.65)],f=d-12,p=d+12,m=0;for(let e=0;e<i*a;e++){let t=l.data[e*4],n=t<=f?0:t>=p?255:Math.round((t-f)/(p-f)*255);l.data[e*4+3]=n,n>127&&m++}let h=m/(i*a);if(h<.08||h>.7)return null;c.putImageData(l,0,0);let g=o(),_=g.getContext(`2d`);_.filter=`blur(${Math.max(1,i/300)}px)`,_.drawImage(s,0,0);let v=o(),y=v.getContext(`2d`);y.drawImage(e,t.x,t.y,t.w,t.h,0,0,i,a),y.globalCompositeOperation=`destination-in`,y.drawImage(g,0,0);let b=o(),x=b.getContext(`2d`);x.drawImage(e,t.x,t.y,t.w,t.h,0,0,i,a);let S=o(),C=S.getContext(`2d`);C.filter=`blur(${Math.max(4,i/40)}px)`,C.drawImage(g,0,0),C.drawImage(g,0,0);let w=o(),T=w.getContext(`2d`);return T.filter=`blur(${Math.max(8,i/25)}px)`,T.drawImage(e,t.x,t.y,t.w,t.h,-i*.05,-a*.05,i*1.1,a*1.1),T.filter=`none`,T.globalCompositeOperation=`destination-in`,T.drawImage(S,0,0),x.drawImage(w,0,0),{fg:v,bg:b}}export{m as a,p as i,v as n,h as r,y as t};