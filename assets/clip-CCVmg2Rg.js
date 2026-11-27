import{i as e,t}from"./jobs-13sp0Z_z.js";import{o as n,t as r}from"./hardware-DBvaZWCb.js";var i=`https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1`,a=`Xenova/clip-vit-base-patch32`,o=`
import { AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env } from '${i}';
env.allowLocalModels = false;
let proc = null, vision = null, tok = null, text = null, dev = 'wasm';
${r}
// on the graphics card when it can (fp16/fp32), else the compact model on the processor
const load = async (Cls, what, id) => { const g = await gpuPick(); if (g) { try { const m = await Cls.from_pretrained('${a}', { ...g, progress_callback: prog(id, what) }); dev = 'webgpu'; return m; } catch {} } dev = 'wasm'; return Cls.from_pretrained('${a}', { dtype: 'q8', progress_callback: prog(id, what) }); };
const norm = (d, dim) => { const out = []; for (let k = 0; k < d.length / dim; k++) { const v = d.slice(k * dim, (k + 1) * dim); let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; out.push(Array.from(v, (x) => x / n)); } return out; };
const prog = (id, what) => (p) => { if (p.status === 'progress') self.postMessage({ id, type: 'load', what, p: (p.progress || 0) / 100 }); };
self.onmessage = async (ev) => {
  const { id, kind, items } = ev.data;
  try {
    if (kind === 'image') {
      proc ??= await AutoProcessor.from_pretrained('${a}');
      vision ??= await load(CLIPVisionModelWithProjection, 'image', id);
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const img = await RawImage.fromBlob(items[i]);
        const { image_embeds } = await vision(await proc(img));
        out.push(...norm(image_embeds.data, image_embeds.dims.at(-1)));
        self.postMessage({ id, type: 'step', p: (i + 1) / items.length });
      }
      self.postMessage({ id, type: 'done', out, device: dev });
    } else {
      tok ??= await AutoTokenizer.from_pretrained('${a}');
      text ??= await load(CLIPTextModelWithProjection, 'texte', id);
      const { text_embeds } = await text(tok(items, { padding: true, truncation: true }));
      self.postMessage({ id, type: 'done', out: norm(text_embeds.data, text_embeds.dims.at(-1)), device: dev });
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`,s=null,c=0;e(`clip`,()=>{s?.terminate(),s=null});function l(e,r,i){return t(`clip`,()=>new Promise((t,a)=>{s??=new Worker(URL.createObjectURL(new Blob([o],{type:`text/javascript`})),{type:`module`});let l=++c,u=s,d=e=>{let r=e.data;r.id===l&&(r.type===`load`&&i?.(`Chargement du modèle image ↔ texte (${r.what})…`,r.p),r.type===`step`&&i?.(`Analyse des images…`,r.p),r.type===`error`&&(u.removeEventListener(`message`,d),a(Error(`Modèle image ↔ texte : `+r.message))),r.type===`done`&&(u.removeEventListener(`message`,d),r.device&&n(`Recherche visuelle (CLIP)`,r.device),t(r.out)))};u.addEventListener(`message`,d),u.postMessage({id:l,kind:e,items:r})}))}async function u(e,t){return l(`image`,await Promise.all(e.map(async e=>{try{let t=await createImageBitmap(e,{resizeWidth:336,resizeQuality:`medium`}),n=new OffscreenCanvas(t.width,t.height);return n.getContext(`2d`).drawImage(t,0,0),t.close(),await n.convertToBlob({type:`image/jpeg`,quality:.9})}catch{return e}})),t)}var d=(e,t)=>l(`text`,e,t),f=e=>{let t=Float32Array.from(e),n=``,r=new Uint8Array(t.buffer);for(let e=0;e<r.length;e++)n+=String.fromCharCode(r[e]);return btoa(n)},p=e=>{let t=atob(e),n=new Uint8Array(t.length);for(let e=0;e<t.length;e++)n[e]=t.charCodeAt(e);return new Float32Array(n.buffer)},m=(e,t)=>{let n=0;for(let r=0;r<Math.min(e.length,t.length);r++)n+=e[r]*t[r];return n};export{m as dot,u as embedImages,d as embedTexts,f as packVec,p as unpackVec};