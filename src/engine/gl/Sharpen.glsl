// Author: Forge (after AMD FidelityFX Contrast Adaptive Sharpening, MIT)
// License: MIT
// Description: Contrast-adaptive sharpening: restores the ink lines of upscaled scans without halos on flat colour or text
// Not a transition: `progress` is ignored, `_from` is the frame.

// @range(0, 1) Sharpening strength
uniform float amount; // = 0.5
uniform float texW; // = 1080.0
uniform float texH; // = 1920.0
// @range(1, 4) Sampling radius in pixels: follows how much the scan is enlarged
uniform float radius; // = 1.0

vec4 transition(vec2 uv) {
  vec2 px = vec2(radius / texW, radius / texH);
  vec3 a = getFromColor(uv + vec2(-px.x, -px.y)).rgb;
  vec3 b = getFromColor(uv + vec2(0.0, -px.y)).rgb;
  vec3 c = getFromColor(uv + vec2(px.x, -px.y)).rgb;
  vec3 d = getFromColor(uv + vec2(-px.x, 0.0)).rgb;
  vec4 E = getFromColor(uv);
  vec3 e = E.rgb;
  vec3 f = getFromColor(uv + vec2(px.x, 0.0)).rgb;
  vec3 g = getFromColor(uv + vec2(-px.x, px.y)).rgb;
  vec3 h = getFromColor(uv + vec2(0.0, px.y)).rgb;
  vec3 i = getFromColor(uv + vec2(px.x, px.y)).rgb;
  vec3 mn = min(min(min(d, e), min(f, b)), h);
  vec3 mn2 = min(mn, min(min(a, c), min(g, i)));
  mn += mn2;
  vec3 mx = max(max(max(d, e), max(f, b)), h);
  vec3 mx2 = max(mx, max(max(a, c), max(g, i)));
  mx += mx2;
  // how much room there is to sharpen without clipping: little on edges already at full contrast
  vec3 amp = clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0);
  amp = sqrt(amp);
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, clamp(amount, 0.0, 1.0)));
  vec3 col = (b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w);
  return vec4(clamp(col, 0.0, 1.0), E.a);
}
