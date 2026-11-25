/**
 * GPU transitions: shaders from gl-transitions (MIT, see LICENSE-gl-transitions),
 * run on a small WebGL canvas and drawn back into the 2D frame. Same code for
 * the preview and the export. Without WebGL the caller falls back to a fade.
 */
import CrossZoom from './CrossZoom.glsl?raw';
import DirectionalWarp from './DirectionalWarp.glsl?raw';
import DefocusBlur from './DefocusBlur.glsl?raw';
import Halftone from './Halftone.glsl?raw';
import InkBleed from './InkBleed.glsl?raw';
import WarpSpeed from './WarpSpeed.glsl?raw';
import GravityLens from './GravityLens.glsl?raw';
import GlitchDisplace from './GlitchDisplace.glsl?raw';
import DirectionalWipe from './DirectionalWipe.glsl?raw';

const SOURCES: Record<string, string> = { CrossZoom, DirectionalWarp, DefocusBlur, Halftone, InkBleed, WarpSpeed, GravityLens, GlitchDisplace, DirectionalWipe };

import { parseUniforms, type Uniform } from './parse';

interface Prog { prog: WebGLProgram; uniforms: Uniform[]; loc: Map<string, WebGLUniformLocation | null> }

const VERT = `attribute vec2 p; varying vec2 _uv; void main(){ _uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const fragOf = (src: string) => `precision highp float;
varying vec2 _uv;
uniform sampler2D _from, _to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv){ return texture2D(_from, uv); }
vec4 getToColor(vec2 uv){ return texture2D(_to, uv); }
${src}
void main(){ gl_FragColor = transition(_uv); }`;

let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let broken = false;
const progs = new Map<string, Prog | null>();
let tex: [WebGLTexture, WebGLTexture] | null = null;

function context(): WebGLRenderingContext | null {
  if (broken) return null;
  if (gl && !gl.isContextLost()) return gl;
  progs.clear();
  tex = null;
  canvas = document.createElement('canvas');
  gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
  if (!gl) { broken = true; return null; }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const mk = () => {
    const t = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return t;
  };
  tex = [mk(), mk()];
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  return gl;
}

function program(name: string): Prog | null {
  if (progs.has(name)) return progs.get(name)!;
  const g = context();
  const src = SOURCES[name];
  if (!g || !src) return null;
  const sh = (type: number, code: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, code);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(`${name}: ${g.getShaderInfoLog(s)}`);
    return s;
  };
  let p: Prog | null = null;
  try {
    const prog = g.createProgram()!;
    g.attachShader(prog, sh(g.VERTEX_SHADER, VERT));
    g.attachShader(prog, sh(g.FRAGMENT_SHADER, fragOf(src)));
    g.bindAttribLocation(prog, 0, 'p');
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(`${name}: ${g.getProgramInfoLog(prog)}`);
    const uniforms = parseUniforms(src);
    const loc = new Map<string, WebGLUniformLocation | null>();
    for (const n of ['_from', '_to', 'progress', 'ratio', ...uniforms.map((u) => u.name)]) loc.set(n, g.getUniformLocation(prog, n));
    p = { prog, uniforms, loc };
  } catch (e) {
    console.warn('[forge] transition GPU indisponible', e);
  }
  progs.set(name, p);
  return p;
}

export const glSupported = () => !!context();

/**
 * Draw transition `name` between frames A and B at `progress` into ctx.
 * Returns false (nothing drawn) when WebGL or the shader is unavailable.
 */
export function drawGlTransition(
  ctx: CanvasRenderingContext2D, name: string, A: HTMLCanvasElement, B: HTMLCanvasElement,
  progress: number, params: Record<string, number>,
): boolean {
  const p = program(name);
  const g = gl;
  if (!p || !g || !canvas || !tex) return false;
  const W = A.width, H = A.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  g.viewport(0, 0, W, H);
  g.useProgram(p.prog);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  [A, B].forEach((img, i) => {
    g.activeTexture(g.TEXTURE0 + i);
    g.bindTexture(g.TEXTURE_2D, tex![i]);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
  });
  g.uniform1i(p.loc.get('_from')!, 0);
  g.uniform1i(p.loc.get('_to')!, 1);
  g.uniform1f(p.loc.get('progress')!, progress);
  g.uniform1f(p.loc.get('ratio')!, W / H);
  for (const u of p.uniforms) {
    const l = p.loc.get(u.name);
    if (!l) continue;
    const v = u.name in params ? [params[u.name]] : u.def;
    if (u.type === 'float') g.uniform1f(l, v[0] ?? 0);
    else if (u.type === 'int' || u.type === 'bool') g.uniform1i(l, Math.round(v[0] ?? 0));
    else if (u.type === 'vec2') g.uniform2f(l, u.def[0] ?? 0, u.def[1] ?? 0);
    else g.uniform4f(l, u.def[0] ?? 0, u.def[1] ?? 0, u.def[2] ?? 0, u.def[3] ?? 1);
  }
  g.drawArrays(g.TRIANGLES, 0, 6);
  if (g.getError() !== g.NO_ERROR) return false;
  ctx.drawImage(canvas, 0, 0, W, H);
  return true;
}
