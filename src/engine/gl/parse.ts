/** reads the uniforms of a gl-transitions shader and their `// = default` values */
export type UType = 'float' | 'vec2' | 'vec4' | 'int' | 'bool';
export interface Uniform { name: string; type: UType; def: number[] }

/** the uniforms a transition declares, with their `// = default` values */
export function parseUniforms(src: string): Uniform[] {
  const out: Uniform[] = [];
  const re = /^\s*uniform\s+(float|vec2|vec4|int|bool)\s+(\w+)\s*;\s*\/\/\s*=\s*([^\n]+)$/gm;
  for (let m; (m = re.exec(src));) {
    const nums = (m[3].replace(/^\s*[a-z]*vec\d\s*/, '').match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const val = m[3].trim().startsWith('true') ? [1] : m[3].trim().startsWith('false') ? [0] : nums;
    out.push({ name: m[2], type: m[1] as UType, def: val });
  }
  return out;
}

