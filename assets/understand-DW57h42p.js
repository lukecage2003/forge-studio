import{n as e}from"./rolldown-runtime-XKyaHtl9.js";import{u as t}from"./media-NZmTmA5T.js";import{t as n}from"./panelAI-DVLjpTbm.js";import{n as r,t as i}from"./bridge-fr-en-DnX8xuCf.js";import{i as a,t as o}from"./jobs-13sp0Z_z.js";import{o as s,t as c}from"./hardware-DBvaZWCb.js";var l=`https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/`,u=1280,d=2400,f=`
import * as ort from '${l}ort.webgpu.min.mjs';
ort.env.wasm.wasmPaths = '${l}';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
let det = null, rec = null, chars = null;
${c}
let detDevice = 'wasm';
async function session(url, gpu) {
  const buf = await (await fetch(url)).arrayBuffer();
  // the line detector may run on the graphics card; the reader stays on the processor:
  // its input width changes on every line, which WebGPU recompiles each time
  if (gpu && await gpuPick()) { try { const s = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] }); detDevice = 'webgpu'; return s; } catch {} }
  return ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
}
async function load(base) {
  if (!det) det = await session(base + 'ocr-det-v3.onnx', true);
  if (!rec) rec = await session(base + 'ocr-rec-en-v5.onnx');
  if (!chars) chars = ['', ...(await (await fetch(base + 'ocr-rec-en-v5.txt')).text()).split('\\n').filter((c, i, a) => i < a.length - 1 || c), ' '];
}
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
// bilinear sample of an RGBA buffer into a CHW float tensor
function sample(src, sw, sh, x0, y0, cw, ch, dw, dh, norm) {
  const t = new Float32Array(3 * dw * dh), P = dw * dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, y0 + (y + 0.5) * ch / dh - 0.5)), iy = Math.floor(fy), ay = fy - iy, iy2 = Math.min(sh - 1, iy + 1);
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, x0 + (x + 0.5) * cw / dw - 0.5)), ix = Math.floor(fx), ax = fx - ix, ix2 = Math.min(sw - 1, ix + 1);
      for (let c = 0; c < 3; c++) {
        const a = src[(iy * sw + ix) * 4 + c], b = src[(iy * sw + ix2) * 4 + c], d = src[(iy2 * sw + ix) * 4 + c], e = src[(iy2 * sw + ix2) * 4 + c];
        const v = ((a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay) / 255;
        t[c * P + y * dw + x] = norm(v, c);
      }
    }
  }
  return t;
}
self.onmessage = async (ev) => {
  const { id, base, rgba, W, H } = ev.data;
  try {
    await load(base);
    // 1. text lines: probability map, connected regions, grown back to the full line (DB "unclip")
    const k = Math.min(1, ${u} / Math.max(W, H));
    const w = Math.max(32, Math.round(W * k / 32) * 32), h = Math.max(32, Math.round(H * k / 32) * 32);
    const inp = sample(rgba, W, H, 0, 0, W, H, w, h, (v, c) => (v - MEAN[c]) / STD[c]);
    const o = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, h, w]) });
    const p = o[det.outputNames[0]].data;
    const seen = new Uint8Array(w * h), boxes = [], q = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || p[s] <= 0.3) continue;
      let n = 0, head = 0, sum = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
      q[n++] = s; seen[s] = 1;
      while (head < n) {
        const i = q[head++], x = i % w, y = (i - x) / w;
        sum += p[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !seen[i - 1] && p[i - 1] > 0.3) { seen[i - 1] = 1; q[n++] = i - 1; }
        if (x < w - 1 && !seen[i + 1] && p[i + 1] > 0.3) { seen[i + 1] = 1; q[n++] = i + 1; }
        if (y > 0 && !seen[i - w] && p[i - w] > 0.3) { seen[i - w] = 1; q[n++] = i - w; }
        if (y < h - 1 && !seen[i + w] && p[i + w] > 0.3) { seen[i + w] = 1; q[n++] = i + w; }
      }
      if (n < 10 || sum / n < 0.6) continue;
      const bw = x1 + 1 - x0, bh = y1 + 1 - y0, d = (bw * bh * 1.5) / (2 * (bw + bh));
      const sx = W / w, sy = H / h;
      const bx = Math.max(0, (x0 - d) * sx), by = Math.max(0, (y0 - d) * sy);
      boxes.push({ x: bx, y: by, w: Math.min(W, (x1 + 1 + d) * sx) - bx, h: Math.min(H, (y1 + 1 + d) * sy) - by });
    }
    // 2. read each line: height 48, width keeps the proportions, CTC greedy decoding
    const lines = [];
    for (const b of boxes) {
      if (b.w < 4 || b.h < 4) continue;
      const dw = Math.min(1600, Math.max(16, Math.round(48 * b.w / b.h)));
      const t = sample(rgba, W, H, b.x, b.y, b.w, b.h, dw, 48, (v) => (v - 0.5) / 0.5);
      const r = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, 48, dw]) });
      const out = r[rec.outputNames[0]], [, T, C] = out.dims, D = out.data;
      let text = '', last = 0, ps = 0, np = 0;
      for (let i = 0; i < T; i++) {
        let best = 0, bv = -Infinity;
        for (let c = 0; c < C; c++) { const v = D[i * C + c]; if (v > bv) { bv = v; best = c; } }
        if (best !== last && best !== 0) { text += chars[best] ?? ''; ps += bv; np++; }
        last = best;
      }
      if (np) lines.push({ text: text.trim(), conf: ps / np, ...b });
    }
    self.postMessage({ id, ok: true, lines, device: detDevice });
  } catch (e) { self.postMessage({ id, ok: false, message: String(e && e.message || e) }); }
};`,p=null,m=0,h=!1,g=new Map,_=new Map;a(`ocr`,()=>{p?.terminate(),p=null});function v(){return new URL(`./models/`,location.href).href}var y=e=>g.get(e)??null;async function b(e,t,n,r){if(h||typeof Worker>`u`)return null;let i=g.get(e);if(i)return i;let a=Math.min(1,d/Math.max(n,r)),c=Math.round(n*a),l=Math.round(r*a),u=document.createElement(`canvas`);u.width=c,u.height=l;let y=u.getContext(`2d`,{willReadFrequently:!0});y.imageSmoothingQuality=`high`,y.drawImage(t,0,0,n,r,0,0,c,l);let b=y.getImageData(0,0,c,l).data,x=await o(`ocr`,()=>new Promise(e=>{p||(p=new Worker(URL.createObjectURL(new Blob([f],{type:`text/javascript`})),{type:`module`}),p.onmessage=e=>{let t=e.data,n=_.get(t.id);_.delete(t.id),t.ok?(t.device&&s(`Lecture du texte (PaddleOCR, détection)`,t.device),n?.(t.lines)):(h=!0,console.warn(`Lecture PaddleOCR indisponible :`,t.message),n?.(null))},p.onerror=()=>{h=!0;for(let e of _.values())e(null);_.clear()});let t=++m;_.set(t,e),p.postMessage({id:t,base:v(),rgba:b,W:c,H:l},[b.buffer])}));if(!x)return null;let S=x.map(e=>({...e,x:e.x/a,y:e.y/a,w:e.w/a,h:e.h/a}));return g.set(e,S),S}var x=e({findBalloons:()=>E,ocrPages:()=>O,pageText:()=>L}),S=`https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js`,C=null;async function w(){if(C)return C;let e=await import(S);return C=await(e.createWorker?e:e.default).createWorker([`eng`,`fra`],1,{workerPath:`https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js`,corePath:`https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1`,langPath:`https://tessdata.projectnaptha.com/4.0.0`}),C}var T=(e,t,n)=>e>=n.x&&e<=n.x+n.w&&t>=n.y&&t<=n.y+n.h;function E(e,t,n){let r=Math.min(1,900/Math.max(t,n)),i=Math.round(t*r),a=Math.round(n*r),o=document.createElement(`canvas`);o.width=i,o.height=a;let s=o.getContext(`2d`,{willReadFrequently:!0});s.drawImage(e,0,0,i,a);let c=s.getImageData(0,0,i,a).data,l=new Uint8Array(i*a),u=new Uint8Array(i*a);for(let e=0;e<i*a;e++){let t=c[e*4],n=c[e*4+1],r=c[e*4+2],i=.299*t+.587*n+.114*r;l[e]=+(i>205&&(Math.max(t,n,r)-Math.min(t,n,r)<40||t>200&&n>180&&r<190)),u[e]=+(i<90)}let d=new Int32Array(i*a),f=new Int32Array(i*a),p=[],m=i*a;for(let e=0;e<i*a;e++){if(!l[e]||d[e])continue;let t=0,n=0,o=i,s=a,c=0,h=0;for(f[t++]=e,d[e]=1;t;){let e=f[--t],r=e/i|0,u=e-r*i;n++,u<o&&(o=u),u>c&&(c=u),r<s&&(s=r),r>h&&(h=r);for(let n of[e-1,e+1,e-i,e+i])n<0||n>=i*a||d[n]||!l[n]||n===e-1&&u===0||n===e+1&&u===i-1||(d[n]=1,f[t++]=n)}let g=c-o+1,_=h-s+1,v=g*_;if(v<m*.0012||v>m*.15||g<14||_<8||(o===0||c===i-1)&&(s===0||h===a-1)||n/v<.45)continue;let y=0;for(let e=s;e<=h;e++)for(let t=o;t<=c;t++)y+=u[e*i+t];let b=y/v;b<.02||b>.4||p.push({x:o/r,y:s/r,w:g/r,h:_/r})}return p.sort((e,t)=>Math.abs(e.y-t.y)<Math.min(e.h,t.h)*.5?e.x-t.x:e.y-t.y)}function D(e){return e.replace(/[|¦]/g,`I`).replace(/\s+/g,` `).replace(/(\w)- (\w)/g,`$1$2`).trim()}async function O(e,r){r(-1,0);let i=await k(e,r);if(i)return i;let a=await w(),o=new Map,s=e.pages.filter(e=>!e.skip),c=document.createElement(`canvas`),l=c.getContext(`2d`);for(let i=0;i<s.length;i++){r(i,s.length);let u=s[i],d=t(u.mediaId);if(!d)continue;let f=e.shots.filter(e=>e.pageId===u.id),p=new Map,m=(e,t,n)=>{let r=f.find(n=>T(e,t,n.rect))??f[0];r&&n&&p.set(r.id,[...p.get(r.id)??[],n])},h=n(u.mediaId)?.bubbles.filter(e=>e.s>=.35).map(({x:e,y:t,w:n,h:r})=>({x:e,y:t,w:n,h:r}))??[],g=E(d.img,d.width,d.height),_=(e,t)=>{let n=Math.min(e.x+e.w,t.x+t.w)-Math.max(e.x,t.x),r=Math.min(e.y+e.h,t.y+t.h)-Math.max(e.y,t.y);return n>0&&r>0?n*r/Math.min(e.w*e.h,t.w*t.h):0},v=[...h,...g.filter(e=>!h.some(t=>_(t,e)>.5))];if(v.length)for(let e of v){let t=Math.max(0,e.x-6),n=Math.max(0,e.y-6),r=Math.min(d.width-t,e.w+12),i=Math.min(d.height-n,e.h+12),o=Math.min(3,Math.max(1,90/Math.max(10,i/4)));c.width=Math.round(r*o),c.height=Math.round(i*o),l.filter=`grayscale(1) contrast(1.6)`,l.imageSmoothingQuality=`high`,l.drawImage(d.img,t,n,r,i,0,0,c.width,c.height),l.filter=`none`;let{data:s}=await a.recognize(c),u=s.words.filter(e=>e.confidence>=50).map(e=>e.text.replace(/[^\p{L}\p{N}'’!?.,-]/gu,``)).filter(e=>/\p{L}/u.test(e));m(e.x+e.w/2,e.y+e.h/2,D(u.join(` `)))}else{let e=Math.min(1,1500/Math.max(d.width,d.height));c.width=Math.round(d.width*e),c.height=Math.round(d.height*e),l.filter=`grayscale(1) contrast(1.4)`,l.drawImage(d.img,0,0,c.width,c.height),l.filter=`none`;let{data:t}=await a.recognize(c);for(let n of t.words){let t=n.text.replace(/[^\p{L}\p{N}'’-]/gu,``);n.confidence<55||t.length<2||!/\p{L}/u.test(t)||m((n.bbox.x0+n.bbox.x1)/2/e,(n.bbox.y0+n.bbox.y1)/2/e,t)}}for(let[e,t]of p)o.set(e,D(t.join(` `)))}return r(s.length,s.length),o}async function k(e,r){let i=new Map,a=e.pages.filter(e=>!e.skip);for(let o=0;o<a.length;o++){r(o,a.length);let s=a[o],c=t(s.mediaId);if(!c)continue;let l=await b(s.mediaId,c.img,c.width,c.height);if(!l)return o===0?null:i;let u=e.shots.filter(e=>e.pageId===s.id);for(let[e,t]of A(l,u,n(s.mediaId)?.bubbles.filter(e=>e.s>=.35)??[]))i.set(e,t)}return r(a.length,a.length),i}function A(e,t,n){let r=e.filter(e=>e.conf>=.6&&/\p{L}{2}/u.test(e.text)),i=[];for(let e of r){let t={x:e.x+e.w/2,y:e.y+e.h/2},r=n.find(e=>T(t.x,t.y,e)),a=r?i.find(e=>e.r===r):i.find(r=>!n.includes(r.r)&&Math.abs(r.r.x+r.r.w/2-t.x)<Math.max(r.r.w,e.w)*.6&&e.y-(r.r.y+r.r.h)<e.h*1.2&&e.y>=r.r.y-e.h*.5);if(a||(a={r:r??{x:e.x,y:e.y,w:e.w,h:e.h},lines:[]},i.push(a)),a.lines.push(e),!r){let t=a.r,n=Math.min(t.x,e.x),r=Math.min(t.y,e.y);a.r={x:n,y:r,w:Math.max(t.x+t.w,e.x+e.w)-n,h:Math.max(t.y+t.h,e.y+e.h)-r}}}let a=new Map;for(let e of i){let n=e.r.x+e.r.w/2,r=e.r.y+e.r.h/2,i=t.find(e=>T(n,r,e.rect))??t.find(t=>e.lines.some(e=>T(e.x+e.w/2,e.y+e.h/2,t.rect)))??t[0];if(!i)continue;let o=[...e.lines].sort((e,t)=>Math.abs(e.y-t.y)<Math.min(e.h,t.h)*.5?e.x-t.x:e.y-t.y);a.set(i.id,[...a.get(i.id)??[],{r:e.r,t:o.map(e=>e.text).join(` `)}])}let o=new Map;for(let[e,t]of a)t.sort((e,t)=>e.r.y+e.r.h<=t.r.y+t.r.h*.3?-1:t.r.y+t.r.h<=e.r.y+e.r.h*.3?1:e.r.x-t.r.x),o.set(e,D(t.map(e=>e.t).join(` `)));return o}var j=new Set(`le la les un une des de du d l au aux et ou mais donc or ni car que qui quoi dont où ce cet cette ces son sa ses leur leurs mon ma mes ton ta tes il elle ils elles on nous vous je tu se en y ne pas plus très tout tous toute toutes est sont été être avoir a ont avait fait faire dans sur sous avec pour par sans entre vers chez comme aussi alors puis encore déjà ici là c'est cest qu the a an and or but of to in on at for with by from is are was were be been it its this that these those he she they we you i his her their our your as not no so do does did have has had will would can could just then than there here what who whom which when where why how all any some more most`.split(` `)),M=e=>e.toLowerCase().normalize(`NFD`).replace(/[̀-ͯ]/g,``).replace(/[^a-z0-9]/g,``);function N(e,t){return t.map((t,n)=>{let r=e.pages.find(e=>e.id===t.pageId);return{id:t.id,order:n,text:[t.text,t.desc,(t.chars??[]).join(` `),r?.summary].filter(Boolean).join(` `),chars:t.chars??[]}})}var P=e=>{let t=e.replace(/d/g,`p`);return t.length>=4&&/[^s]s$/.test(t)?t.slice(0,-1):t};function F(e){return e.split(/[\s,.;:!?()«»"“”…—–/-]+/).map(e=>({raw:e,o:M(e)})).filter(e=>e.o.length>=3&&!j.has(e.o)).map(e=>({...e,n:P(e.o)}))}function I(e,t,n){let a=e.length,o=t.length;if(!a||!o)return[];let s=t.map(e=>new Set(F(e.text).map(e=>e.n))),c=new Map;for(let e of s)for(let t of e)c.set(t,(c.get(t)??0)+1);let l=e=>Math.log(1+o/(c.get(e)??o)),u=s.map(e=>new Set([...e].map(i).filter(e=>!!e))),d=new Map;for(let e of u)for(let t of e)d.set(t,(d.get(t)??0)+1);let f=e=>Math.log(1+o/(d.get(e)??o)),p=[],m=e.map(t=>{let a=new Float32Array(o),c=new Uint8Array(o),d=F(t.text);for(let p=0;p<o;p++){let o=0;for(let e of d){if(!s[p].has(e.n)){let t=r(e.o).map(P).filter(e=>s[p].has(e));if(t.length){o+=Math.max(...t.map(l))*.8;continue}let n=i(e.n);n&&u[p].has(n)&&(o+=f(n)*.7);continue}let t=/^\p{Lu}/u.test(e.raw)&&e.raw.length>2,n=/^\d+$/.test(e.n);(t||n)&&c[p]++,o+=l(e.n)*(t?3:n?2:1)}n&&(o+=9*Math.max(0,n[e.indexOf(t)][p]-.3)),a[p]=o}return p.push(c),a}),h=(e,t)=>-1.2*Math.abs(t/Math.max(1,o-1)-e/Math.max(1,a-1)),g=Math.max(1,o/a),_=(e,t)=>t>e?-.35*Math.log1p(Math.max(0,t-e-1-g)/g):t===e?-1.2:-2.5-.1*(e-t),v=Float32Array.from({length:o},(e,t)=>m[0][t]+h(0,t)),y=[];for(let e=1;e<a;e++){let t=new Float32Array(o),n=new Int32Array(o);for(let r=0;r<o;r++){let i=-1/0,a=0;for(let e=0;e<o;e++){let t=v[e]+_(e,r);t>i&&(i=t,a=e)}t[r]=i+m[e][r]+h(e,r),n[r]=a}y.push(n),v=t}let b=0;for(let e=1;e<o;e++)v[e]>v[b]&&(b=e);let x=Array(a);x[a-1]=b;for(let e=a-1;e>0;e--)b=y[e-1][b],x[e-1]=b;return e.map((e,r)=>{let i=m[r],a=[...i.keys()].sort((e,t)=>i[t]-i[e]),o=x[r],s=i[a[0]],c=i[a[1]]??0,l=i[o],u=p[r][o],d=s>0?(i[o]-c)/s:0,f=n?n[r][o]:0,h=f>.55?.3:f>.45?.18:f>.38?.08:0,g=l<=0?.2:Math.min(.92,.22+.18*Math.min(3,u)+.22*Math.max(0,d)+h+(u||h?0:Math.min(.12,l*.03)));return{sentence:r,shotId:t[o].id,conf:g,alts:a.filter(e=>e!==o&&i[e]>0).slice(0,3).map(e=>t[e].id)}})}async function L(e,t,n){let r=await w(),i=Math.min(2,2e3/Math.max(t,n)),a=document.createElement(`canvas`);a.width=Math.round(t*i),a.height=Math.round(n*i);let o=a.getContext(`2d`);o.filter=`grayscale(1) contrast(1.5)`,o.imageSmoothingQuality=`high`,o.drawImage(e,0,0,a.width,a.height),o.filter=`none`;let{data:s}=await r.recognize(a),c=s.words.filter(e=>e.confidence>=55).map(e=>({t:e.text,x:e.bbox.x0/i,y:e.bbox.y0/i,w:(e.bbox.x1-e.bbox.x0)/i,h:(e.bbox.y1-e.bbox.y0)/i}));return{text:c.map(e=>e.t).join(` `),words:c}}export{b as a,y as i,N as n,x as r,I as t};