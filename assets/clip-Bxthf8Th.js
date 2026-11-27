import{i as e,t}from"./jobs-13sp0Z_z.js";var n=`https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1`,r=`Xenova/clip-vit-base-patch32`,i=`
import { AutoProcessor, CLIPVisionModelWithProjection, AutoTokenizer, CLIPTextModelWithProjection, RawImage, env } from '${n}';
env.allowLocalModels = false;
let proc = null, vision = null, tok = null, text = null;
const norm = (d, dim) => { const out = []; for (let k = 0; k < d.length / dim; k++) { const v = d.slice(k * dim, (k + 1) * dim); let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; out.push(Array.from(v, (x) => x / n)); } return out; };
const prog = (id, what) => (p) => { if (p.status === 'progress') self.postMessage({ id, type: 'load', what, p: (p.progress || 0) / 100 }); };
self.onmessage = async (ev) => {
  const { id, kind, items } = ev.data;
  try {
    if (kind === 'image') {
      proc ??= await AutoProcessor.from_pretrained('${r}');
      vision ??= await CLIPVisionModelWithProjection.from_pretrained('${r}', { dtype: 'q8', progress_callback: prog(id, 'image') });
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const img = await RawImage.fromBlob(items[i]);
        const { image_embeds } = await vision(await proc(img));
        out.push(...norm(image_embeds.data, image_embeds.dims.at(-1)));
        self.postMessage({ id, type: 'step', p: (i + 1) / items.length });
      }
      self.postMessage({ id, type: 'done', out });
    } else {
      tok ??= await AutoTokenizer.from_pretrained('${r}');
      text ??= await CLIPTextModelWithProjection.from_pretrained('${r}', { dtype: 'q8', progress_callback: prog(id, 'texte') });
      const { text_embeds } = await text(tok(items, { padding: true, truncation: true }));
      self.postMessage({ id, type: 'done', out: norm(text_embeds.data, text_embeds.dims.at(-1)) });
    }
  } catch (e) { self.postMessage({ id, type: 'error', message: String(e && e.message || e) }); }
};`,a=null,o=0;e(`clip`,()=>{a?.terminate(),a=null});function s(e,n,r){return t(`clip`,()=>new Promise((t,s)=>{a??=new Worker(URL.createObjectURL(new Blob([i],{type:`text/javascript`})),{type:`module`});let c=++o,l=a,u=e=>{let n=e.data;n.id===c&&(n.type===`load`&&r?.(`Chargement du modèle image ↔ texte (${n.what})…`,n.p),n.type===`step`&&r?.(`Analyse des images…`,n.p),n.type===`error`&&(l.removeEventListener(`message`,u),s(Error(`Modèle image ↔ texte : `+n.message))),n.type===`done`&&(l.removeEventListener(`message`,u),t(n.out)))};l.addEventListener(`message`,u),l.postMessage({id:c,kind:e,items:n})}))}async function c(e,t){return s(`image`,await Promise.all(e.map(async e=>{try{let t=await createImageBitmap(e,{resizeWidth:336,resizeQuality:`medium`}),n=new OffscreenCanvas(t.width,t.height);return n.getContext(`2d`).drawImage(t,0,0),t.close(),await n.convertToBlob({type:`image/jpeg`,quality:.9})}catch{return e}})),t)}var l=(e,t)=>s(`text`,e,t),u=e=>{let t=Float32Array.from(e),n=``,r=new Uint8Array(t.buffer);for(let e=0;e<r.length;e++)n+=String.fromCharCode(r[e]);return btoa(n)},d=e=>{let t=atob(e),n=new Uint8Array(t.length);for(let e=0;e<t.length;e++)n[e]=t.charCodeAt(e);return new Float32Array(n.buffer)},f=(e,t)=>{let n=0;for(let r=0;r<Math.min(e.length,t.length);r++)n+=e[r]*t[r];return n};export{f as dot,c as embedImages,l as embedTexts,u as packVec,d as unpackVec};