import { AiError } from '../types';
import { scrub } from '../vault';

/** fetch + uniform error classes: bad key, quota (with Retry-After), network, server, bad request */
export async function call(url: string, init: RequestInit, who: string): Promise<Response> {
  let res: Response;
  try { res = await fetch(url, init); }
  catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('network', `${who} injoignable (réseau coupé, serveur arrêté ou appel bloqué par le navigateur).`);
  }
  if (res.ok) return res;
  let msg = res.statusText;
  try { const d = await res.clone().json(); msg = d?.error?.message ?? d?.error ?? d?.message ?? msg; if (typeof msg !== 'string') msg = JSON.stringify(msg); } catch { try { msg = (await res.text()).slice(0, 200) || msg; } catch { /* */ } }
  msg = scrub(String(msg));
  const ra = Number(res.headers.get('retry-after'));
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api[ _-]?key|unauthori[sz]ed|invalid.*key/i.test(msg))) throw new AiError('auth', `${who} : clé refusée (${msg}).`, { status: res.status });
  if (res.status === 429 || res.status === 402) throw new AiError('quota', `${who} : quota ou crédit épuisé (${msg}).`, { status: res.status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : 60 });
  if (res.status >= 500) throw new AiError('server', `${who} : service en panne (${res.status}).`, { status: res.status });
  throw new AiError('bad-request', `${who} : requête refusée (${msg}).`, { status: res.status });
}

/** 16 kHz mono PCM → WAV */
export function wav(pcm: Float32Array, sr = 16000): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
  const s = (o: number, t: string) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}
