/**
 * What this computer can do, read from the browser (no benchmark needed):
 * processor cores, memory, graphics card through WebGPU (name, 16-bit
 * shaders, largest buffer). Forge uses it to pick sizes that fit: Whisper
 * model, local language model, preview resolution, motion-blur samples.
 * The performance check (Réglages) refines it with measured times.
 */
export interface Hardware {
  cores: number;
  memoryGb: number | null;
  webgpu: boolean;
  gpu: string;
  f16: boolean;
  /** largest GPU buffer (MB): bounds the local model size */
  maxBufferMb: number;
  tier: 'low' | 'mid' | 'high';
}
let cached: Promise<Hardware> | null = null;
/** last detection, for synchronous checks (null until the first detection ends) */
export let lastHardware: Hardware | null = null;

export function detectHardware(): Promise<Hardware> {
  cached ??= (async () => {
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: { requestAdapter: (o?: unknown) => Promise<null | { features: Set<string>; limits: Record<string, number>; info?: { vendor?: string; architecture?: string; description?: string } }> } };
    const cores = navigator.hardwareConcurrency || 2;
    const memoryGb = nav.deviceMemory ?? null;
    let webgpu = false, gpu = 'inconnue', f16 = false, maxBufferMb = 0;
    try {
      const a = await nav.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (a) {
        webgpu = true;
        f16 = a.features.has('shader-f16');
        maxBufferMb = Math.round((a.limits.maxBufferSize ?? 0) / 1048576);
        gpu = [a.info?.vendor, a.info?.architecture, a.info?.description].filter(Boolean).join(' ') || 'carte graphique WebGPU';
      }
    } catch { /* no WebGPU */ }
    const soft = /swiftshader|llvmpipe|software/i.test(gpu);
    const score = (webgpu && !soft ? 2 : 0) + (cores >= 8 ? 1 : 0) + ((memoryGb ?? 4) >= 8 ? 1 : 0) + (maxBufferMb >= 2048 ? 1 : 0);
    lastHardware = { cores, memoryGb, webgpu: webgpu && !soft, gpu, f16, maxBufferMb, tier: score >= 4 ? 'high' : score >= 2 ? 'mid' : 'low' };
    return lastHardware;
  })();
  return cached;
}

export interface Advice { whisper: 'tiny' | 'base' | 'small'; llm: string | null; previewScale: number; blurSamples: number; text: string[] }

/** sizes that fit this computer */
export function advise(h: Hardware): Advice {
  const llm = !h.webgpu ? null : h.maxBufferMb >= 4096 && (h.memoryGb ?? 8) >= 16 ? 'Qwen2.5-7B-Instruct-q4f16_1-MLC' : h.maxBufferMb >= 2048 ? 'Qwen2.5-3B-Instruct-q4f16_1-MLC' : 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
  const a: Advice = {
    whisper: h.tier === 'high' ? 'small' : h.tier === 'mid' ? 'base' : 'tiny',
    llm,
    previewScale: h.tier === 'low' ? 0.5 : h.tier === 'mid' ? 0.75 : 1,
    blurSamples: h.tier === 'low' ? 2 : 4,
    text: [],
  };
  a.text.push(`${h.cores} cœurs${h.memoryGb ? `, ${h.memoryGb} Go de mémoire (ou plus)` : ''}, carte graphique : ${h.webgpu ? h.gpu : 'non accessible (WebGPU)'}.`);
  a.text.push(`Transcription locale conseillée : Whisper « ${a.whisper} ».`);
  a.text.push(llm ? `IA locale sur la carte graphique possible : ${llm.replace(/-q4f16_1-MLC$/, '')}.` : 'Pas d’IA locale sur la carte graphique ici : Ollama, LM Studio ou les IA gratuites en ligne prennent le relais.');
  a.text.push(`Aperçu en ${Math.round(a.previewScale * 100)} % de la définition (l’export reste en pleine définition).`);
  return a;
}
