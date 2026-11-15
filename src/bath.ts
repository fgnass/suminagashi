// SUMINAGASHI: floating ink on water.
//
// Two complementary models:
//  1. Drops (ink, clear water) are an exact, area-preserving radial
//     deformation of the ink film (the "mathematical marbling" drop map).
//     That is what makes crisp concentric rings that get thinner with every
//     new drop.
//  2. Whatever moves the water (a breath, a straw, a pin, a nudge) drives a
//     2D incompressible fluid (stable fluids + vorticity confinement) which
//     advects the ink film with clamped Catmull-Rom sampling, so lines stay
//     sharp.
//  A whisker is a fine "tine" deformation: it combs thin lines without
//  shedding vortices.
//
// Coordinates in this API are uv, 0..1 both ways, y up. Inside, the bath
// is `aspect` wide and 1 high, so circles stay round. Areas are in that
// unit squared. The film holds how much of each colour role lies where
// (`ROLES` of them, four to a texture). What a role looks like is its ink
// (`inks`): its absorbance per channel (Beer–Lambert), what it takes out of
// the light, so overlapping films darken. Change the inks and the picture on
// the water changes its colours with them.

// Coarse on purpose: the picture is scaled up (see `scale`), and the GPU
// load falls with the square of these.
const SIM_LONG = 224
// The ink film's long side at most; `?ink=` sets it. A phone's screen is
// sharp enough for more than 1024.
const INK_MAX = +(new URLSearchParams(location.search).get('ink') ?? 0) || 1600
const JACOBI = 18
/** The drift is added every this many steps. */
const DRIFT_EVERY = 4
const MAXS = 32
const COVER_W = 16
const COVER_H = 9
/** How many colour roles the film can hold: four to a layer. A paint is a
 *  weight per role; the second layer is only made when a role above the
 *  fourth is used. */
export const ROLES = 8

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos,0.0,1.0); }`

const COMMON = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;

float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float worley(vec2 p){ vec2 i=floor(p), f=fract(p); float d=8.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 g=vec2(x,y); d=min(d,length(g+hash22(i+g)-f)); } return d; }

// Catmull-Rom sampling, clamped to the 2x2 neighbourhood (no overshoot).
vec4 sampleCR(sampler2D t, vec2 uv, vec2 size){
  vec2 p = uv*size - 0.5;
  vec2 f = fract(p); ivec2 i = ivec2(floor(p));
  vec2 w0 = f*(-0.5 + f*(1.0 - 0.5*f));
  vec2 w1 = 1.0 + f*f*(-2.5 + 1.5*f);
  vec2 w2 = f*(0.5 + f*(2.0 - 1.5*f));
  vec2 w3 = f*f*(-0.5 + 0.5*f);
  // vec4, not float[4]: some Android drivers give an array constructor no
  // precision and refuse the shader
  vec4 wx = vec4(w0.x,w1.x,w2.x,w3.x);
  vec4 wy = vec4(w0.y,w1.y,w2.y,w3.y);
  ivec2 m = ivec2(size)-1;
  vec4 r = vec4(0), mn = vec4(1e9), mx = vec4(-1e9);
  for(int y=0;y<4;y++) for(int x=0;x<4;x++){
    vec4 s = texelFetch(t, clamp(i+ivec2(x-1,y-1), ivec2(0), m), 0);
    r += s*wx[x]*wy[y];
    if(x>=1 && x<=2 && y>=1 && y<=2){ mn=min(mn,s); mx=max(mx,s); }
  }
  return clamp(r, mn, mx);
}
`

/** The film's absorbance: each layer's roles times their inks. */
const ABSORB = `
uniform sampler2D uInk, uInk2; uniform mat4x3 uM0, uM1;
vec3 absorb(vec2 uv){ return uM0*texture(uInk, uv) + uM1*texture(uInk2, uv); }
`

const FS: Record<string, string> = {
  copy: `${COMMON}
uniform sampler2D uSrc; uniform float uScale;
void main(){ o = texture(uSrc, vUv)*uScale; }`,

  advectVel: `${COMMON}
uniform sampler2D uVel; uniform float uDt, uAspect, uDamp, uSnap;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 uv = vUv - uDt*v/vec2(uAspect,1.0);
  vec2 nv = texture(uVel, uv).xy*uDamp;
  if(length(nv) < uSnap) nv = vec2(0);
  o = vec4(nv,0,1);
}`,

  advectInk: `${COMMON}
uniform sampler2D uInk, uVel; uniform vec2 uInkSize; uniform float uDt, uAspect, uFade;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 disp = uDt*v/vec2(uAspect,1.0);
  if(length(disp*uInkSize) < 0.01){ o = texelFetch(uInk, ivec2(gl_FragCoord.xy), 0)*uFade; return; }
  o = sampleCR(uInk, vUv - disp, uInkSize)*uFade;
}`,

  //  mode 1: pin – drag the water (blend toward uDir)
  //  mode 2: jet – breath / straw, from uP along uDir
  //  mode 3: impulse – add uDir in a gaussian blob
  //  mode 4: drift – slow curl-noise current
  force: `${COMMON}
uniform sampler2D uVel; uniform int uMode; uniform vec2 uP, uDir;
uniform float uRadius, uStrength, uNoise, uNoiseFreq, uSpread, uLen, uTime, uDt, uAspect;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec2 p = vUv*vec2(uAspect,1.0);
  if(uMode==1){
    float d = length(p-uP); float w = exp(-d*d/(uRadius*uRadius));
    v = mix(v, uDir, clamp(w*uStrength, 0., 1.));
  } else if(uMode==2){
    vec2 n = vec2(-uDir.y, uDir.x);
    vec2 rel = p-uP; float a = dot(rel,uDir); float b = dot(rel,n);
    float width = uRadius + max(a,0.)*uSpread;
    float fall = exp(-b*b/(width*width)) * exp(-max(a,0.)/uLen) * smoothstep(-uRadius, uRadius*0.5, a);
    vec2 q = p*uNoiseFreq;
    float n1 = fbm(q + vec2(0., -uTime*3.)) - 0.5;
    float n2 = fbm(q*1.7 + vec2(13.1, uTime*2.3)) - 0.5;
    vec2 f = uDir*(1.0 + uNoise*2.0*n1) + n*uNoise*2.5*n2;
    v += f * fall * uStrength * uDt * (uRadius/width);
  } else if(uMode==3){
    float d = length(p-uP);
    v += uDir*exp(-d*d/(uRadius*uRadius));
  } else if(uMode==4){
    float e = 0.01; vec2 q = p*1.3 + vec2(uTime*0.013, -uTime*0.009);
    float a = fbm(q+vec2(0,e)), b = fbm(q-vec2(0,e)), c = fbm(q+vec2(e,0)), d = fbm(q-vec2(e,0));
    vec2 curl = vec2(a-b, -(c-d))/(2.*e);
    v += curl*uStrength*uDt;
  }
  o = vec4(v,0,1);
}`,

  curl: `${COMMON}
uniform sampler2D uVel; uniform vec2 uSize; uniform float uH;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  float L = texelFetch(uVel, clamp(c-ivec2(1,0),ivec2(0),m),0).y;
  float R = texelFetch(uVel, clamp(c+ivec2(1,0),ivec2(0),m),0).y;
  float B = texelFetch(uVel, clamp(c-ivec2(0,1),ivec2(0),m),0).x;
  float T = texelFetch(uVel, clamp(c+ivec2(0,1),ivec2(0),m),0).x;
  o = vec4(0.5*((R-L)-(T-B))/uH,0,0,1);
}`,

  vorticity: `${COMMON}
uniform sampler2D uVel, uCurl; uniform vec2 uSize; uniform float uH, uEps, uDt;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  float L = abs(texelFetch(uCurl, clamp(c-ivec2(1,0),ivec2(0),m),0).x);
  float R = abs(texelFetch(uCurl, clamp(c+ivec2(1,0),ivec2(0),m),0).x);
  float B = abs(texelFetch(uCurl, clamp(c-ivec2(0,1),ivec2(0),m),0).x);
  float T = abs(texelFetch(uCurl, clamp(c+ivec2(0,1),ivec2(0),m),0).x);
  float C = texelFetch(uCurl, c, 0).x;
  vec2 g = 0.5*vec2(R-L, T-B)/uH;
  vec2 N = g/(length(g)+1e-5);
  vec2 v = texelFetch(uVel, c, 0).xy + uEps*uH*vec2(N.y, -N.x)*C*uDt;
  o = vec4(v,0,1);
}`,

  divergence: `${COMMON}
uniform sampler2D uVel; uniform vec2 uSize; uniform float uH;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  vec2 C = texelFetch(uVel,c,0).xy;
  float L = c.x>0   ? texelFetch(uVel,c-ivec2(1,0),0).x : -C.x;
  float R = c.x<m.x ? texelFetch(uVel,c+ivec2(1,0),0).x : -C.x;
  float B = c.y>0   ? texelFetch(uVel,c-ivec2(0,1),0).y : -C.y;
  float T = c.y<m.y ? texelFetch(uVel,c+ivec2(0,1),0).y : -C.y;
  o = vec4(0.5*(R-L+T-B)/uH,0,0,1);
}`,

  jacobi: `${COMMON}
uniform sampler2D uP, uDiv; uniform vec2 uSize; uniform float uH, uKeep;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  float C = texelFetch(uP,c,0).x;
  float L = c.x>0   ? texelFetch(uP,c-ivec2(1,0),0).x : C;
  float R = c.x<m.x ? texelFetch(uP,c+ivec2(1,0),0).x : C;
  float B = c.y>0   ? texelFetch(uP,c-ivec2(0,1),0).x : C;
  float T = c.y<m.y ? texelFetch(uP,c+ivec2(0,1),0).x : C;
  float d = texelFetch(uDiv,c,0).x;
  // (uKeep: how much of last frame's pressure the solve starts from)
  o = vec4(((L+R+B+T)*uKeep - d*uH*uH)*0.25,0,0,1);
}`,

  gradient: `${COMMON}
uniform sampler2D uP, uVel; uniform vec2 uSize; uniform float uH;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  float C = texelFetch(uP,c,0).x;
  float L = c.x>0   ? texelFetch(uP,c-ivec2(1,0),0).x : C;
  float R = c.x<m.x ? texelFetch(uP,c+ivec2(1,0),0).x : C;
  float B = c.y>0   ? texelFetch(uP,c-ivec2(0,1),0).x : C;
  float T = c.y<m.y ? texelFetch(uP,c+ivec2(0,1),0).x : C;
  vec2 v = texelFetch(uVel,c,0).xy - 0.5*vec2(R-L,T-B)/uH;
  if(c.x==0 || c.x==m.x) v.x = 0.;
  if(c.y==0 || c.y==m.y) v.y = 0.;
  o = vec4(v,0,1);
}`,

  // A touch of viscosity: each cell drawn a little towards its neighbours.
  // It takes out the cell-to-cell zigzag the projection leaves on a coarse
  // grid, which a steady jet otherwise draws into the ink as stripes.
  smoothVel: `${COMMON}
uniform sampler2D uVel; uniform vec2 uSize; uniform float uK;
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); ivec2 m = ivec2(uSize)-1;
  vec2 C = texelFetch(uVel,c,0).xy;
  vec2 L = texelFetch(uVel,clamp(c-ivec2(1,0),ivec2(0),m),0).xy;
  vec2 R = texelFetch(uVel,clamp(c+ivec2(1,0),ivec2(0),m),0).xy;
  vec2 B = texelFetch(uVel,clamp(c-ivec2(0,1),ivec2(0),m),0).xy;
  vec2 T = texelFetch(uVel,clamp(c+ivec2(0,1),ivec2(0),m),0).xy;
  o = vec4(mix(C, (L+R+B+T)*0.25, uK), 0, 1);
}`,

  // Area-preserving deformation of the ink film by a list of sources,
  // walked in reverse (backward mapping).
  //  type 0/1/2: drop (solid / oily / speckled fill). A=(cx,cy,dr2,jag)
//              B=(role,amount,0,type) C=(seed,freq,speed,0)
//  The film is drawn one layer (four roles) at a time: `uLayer`.
  //  type 3:     tine smudge along A.xy to A.xy+C.xy, falloff length C.z,
  //              moving the ink by C.xy times C.w (1 when C.w is 0)
  //  type 4:     swirl round A.xy by the angle A.w, fading out over radius A.z
  deform: `${COMMON}
#define MAXS ${MAXS}
uniform sampler2D uInk; uniform vec2 uInkSize; uniform float uAspect, uTime; uniform int uCount, uLayer;
uniform vec4 uA[MAXS]; uniform vec4 uB[MAXS]; uniform vec4 uC[MAXS];

float angNoise(float a, float seed, float freq, float t, float speed){
  float s = 0.;
  for(int k=2;k<10;k++){
    float fk = float(k)*freq;
    s += sin(a*fk + seed*fk*1.7 + t*(0.6+fract(seed*float(k)*.37))*speed)/float(k);
  }
  return s*0.6;
}

// A drop's paint in this layer: its amount in its role's channel.
vec4 paint(vec4 B){
  int r = int(B.x+0.5) - 4*uLayer;
  return vec4(equal(ivec4(0,1,2,3), ivec4(r)))*B.y;
}

vec4 makeFill(int type, vec4 col, vec2 p, vec4 C){
  if(type==1){ // oil: ink full of tiny clear oil droplets
    float f = worley(p*150. + vec2(C.x*37., uTime*4.));
    float g = worley(p*310. + vec2(uTime*5., C.x*11.));
    float amt = smoothstep(0.22,0.42,f) * (0.55+0.45*smoothstep(0.15,0.35,g));
    return col*amt;
  }
  if(type==2){ // alcohol: cleared film with sparse ink specks
    vec2 q = p*70. + vec2(C.x*19., uTime*1.5);
    vec2 i = floor(q);
    float keep = step(0.86, hash12(i+C.x));
    float dots = 1.0 - smoothstep(0.08,0.2, worley(q));
    float mist = smoothstep(0.55, 0.9, fbm(p*25. + C.x)) * 0.12;
    return col*(keep*dots*0.9 + mist);
  }
  return col;
}

void main(){
  vec2 p = vUv*vec2(uAspect,1.0);
  // A drop's edge is smoothed over a pixel: a hard edge, magnified by the
  // next drop on the same spot, turns the pixel grid into rings.
  float px = 1.0/uInkSize.y, keep = 1.0;
  vec4 acc = vec4(0);
  for(int k=MAXS-1;k>=0;k--){
    if(k>=uCount) continue;
    vec4 A = uA[k], B = uB[k], C = uC[k];
    int type = int(B.w+0.5);
    if(type<=2){
      vec2 d = p-A.xy; float L2 = dot(d,d);
      float dr2 = A.z;
      if(A.w > 0.) dr2 *= max(1.0 + A.w*angNoise(atan(d.y,d.x), C.x, C.y, uTime, C.z), 0.05);
      if(L2 <= dr2){ o = acc + keep*makeFill(type, paint(B), p, C); return; }
      // Just outside, partly this drop's fill, partly what it pushed aside.
      float t = clamp((sqrt(L2) - sqrt(dr2))/px, 0., 1.);
      if(t < 1.){ acc += keep*(1.0-t)*makeFill(type, paint(B), p, C); keep *= t; }
      p = A.xy + d*sqrt(1.0 - dr2/L2);
    } else if(type==4){
      vec2 d = p-A.xy; float q = dot(d,d)/(A.z*A.z);
      if(q < 9.){
        float th = -A.w*exp(-q), c = cos(th), s = sin(th);
        p = A.xy + vec2(c*d.x - s*d.y, s*d.x + c*d.y);
      }
    } else {
      vec2 a = A.xy, ab = C.xy;
      float t = clamp(dot(p-a,ab)/max(dot(ab,ab),1e-12), 0., 1.);
      float dist = length(p-(a+ab*t));
      p -= ab*(C.w > 0. ? C.w : 1.)*exp(-dist/C.z);
    }
  }
  o = acc + keep*sampleCR(uInk, p/vec2(uAspect,1.0), uInkSize);
}`,

  // How much ink lies in each cell of a coarse grid: the mean of the
  // film's absorbance over the cell, sampled on a few points.
  coverage: `${COMMON}${ABSORB}
void main(){
  float s = 0.;
  for(int y=0;y<4;y++) for(int x=0;x<4;x++){
    vec2 q = vUv + (vec2(x,y)-1.5)/4.0 / vec2(${COVER_W}.0, ${COVER_H}.0);
    s += dot(absorb(q), vec3(1.0/3.0));
  }
  o = vec4(clamp(s/16.0, 0., 1.), 0, 0, 1);
}`,

  // The paper laid face down on the water takes up the film: mirrored,
  // a little soft, with fibres and an uneven uptake.
  print: `${COMMON}${ABSORB}
uniform vec2 uInkSize; uniform float uAspect, uSeed; uniform vec3 uPaper;
mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
void main(){
  vec2 iuv = vec2(1.0-vUv.x, vUv.y);
  vec2 tx = 1.2/uInkSize;
  vec3 a = absorb(iuv);
  vec3 bl = (absorb(iuv+vec2(tx.x,0)) + absorb(iuv-vec2(tx.x,0)) +
             absorb(iuv+vec2(0,tx.y)) + absorb(iuv-vec2(0,tx.y)))*0.25;
  a = mix(a, bl, 0.4);
  vec2 p = vUv*vec2(uAspect,1.0) + uSeed;
  vec3 paper = uPaper;
  paper *= 0.965 + 0.05*fbm(p*14.0);
  float fib = 0.0;
  for(int i=0;i<4;i++){
    vec2 q = rot(float(i)*1.9 + uSeed)*p;
    q.y += 0.04*sin(q.x*9.0 + float(i)) + 0.02*fbm(q*6.0);
    fib += smoothstep(0.66, 0.8, fbm(q*vec2(4.0, 90.0) + float(i)*7.3));
  }
  paper += 0.009*fib;
  float uptake = 0.82 + 0.36*fbm(p*120.0);
  o = vec4(paper*exp(-a*1.3*uptake), 1);
}`,

  // The tray's faint unevenness: smooth, so it is drawn once into a small
  // texture instead of every frame for every pixel.
  tray: `${COMMON}
uniform float uAspect;
void main(){ o = vec4(fbm(vUv*vec2(uAspect,1.0)*3.0), 0, 0, 1); }`,

  display: `${COMMON}${ABSORB}
uniform sampler2D uTray; uniform vec2 uInkSize; uniform float uAspect, uGrain; uniform vec3 uGround;
void main(){
  vec3 a = absorb(vUv);
  vec2 tx = 1.0/uInkSize;
  vec3 blur = (absorb(vUv+vec2(1.5*tx.x,0)) + absorb(vUv-vec2(1.5*tx.x,0)) +
               absorb(vUv+vec2(0,1.5*tx.y)) + absorb(vUv-vec2(0,1.5*tx.y)))*0.25;
  a = max(a + 0.7*(a-blur), 0.0);
  float l = dot(absorb(vUv-vec2(tx.x,0)), vec3(1));
  float r = dot(absorb(vUv+vec2(tx.x,0)), vec3(1));
  float b = dot(absorb(vUv-vec2(0,tx.y)), vec3(1));
  float t = dot(absorb(vUv+vec2(0,tx.y)), vec3(1));
  float edge = clamp(length(vec2(r-l, t-b))*0.6, 0., 1.);
  vec2 p = vUv*vec2(uAspect,1.0);
  // water over a pale tray
  vec3 base = uGround;
  base *= 0.985 + 0.015*texture(uTray, vUv).r;
  if(uGrain > 0.) base *= 1.0 - uGrain*(hash12(gl_FragCoord.xy)-0.5);
  vec2 e = min(vUv, 1.0-vUv)*vec2(uAspect,1.0);
  float vign = smoothstep(0.0, 0.025, min(e.x,e.y));
  base *= mix(0.93, 1.0, vign);
  o = vec4(base*exp(-a*(1.0 + 0.55*edge)), 1);
}`,
}

type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
type Double = { read: Target; write: Target; swap(): void; dispose(): void }
type Program = { p: WebGLProgram; u: Record<string, { loc: WebGLUniformLocation | null; type: number }> }
type Uniform = number | number[] | Float32Array | Target
type Source = { A: number[]; B: number[]; C: number[] }
type Force = Record<string, Uniform>
/** A swirl turning the film round a point over a little time: `turn` in
 *  all, eased in and out over `length` seconds. */
type Swirl = { x: number; y: number; radius: number; turn: number; length: number; age: number; delay: number }
/** A drop spreading over time: `area` in all, most of it in the first
 *  `tau` seconds. While `held`, it keeps welling up. */
export type Drop = { x: number; y: number; area: number; tau: number; age: number; held: boolean; release: number; delay: number; total: number; ink: number[]; type: number; seed: number; jag: number; freq: number; speed: number; alcohol?: boolean; instant?: boolean; length?: number; pace?: number }

const hash = (n: number) => { let h = Math.imul(n ^ 0x5bd1e995, 2246822519); h = Math.imul(h ^ h >>> 13, 3266489917); return ((h ^ h >>> 16) >>> 0) / 4294967296 }

export class Bath {
  readonly gl: WebGL2RenderingContext
  private canvas: HTMLCanvasElement
  private P: Record<string, Program> = {}
  /** The film: one layer of four roles, two once a role above the fourth
   *  is used. */
  private film: Double[] = []
  /** A texture of nothing, read in place of a second layer there is not. */
  private none!: Target
  private vel!: Double
  private pres!: Double
  private divT!: Target
  private curlT!: Target
  private simW = 0
  private simH = 0
  private time = 0
  private driftDt = 0
  private driftN = 0
  private count = 0
  private drops: Drop[] = []
  private forces: Force[] = []
  private sources: Source[] = []
  private swirls: Swirl[] = []
  aspect = 1
  /** The tray under the water, display rgb. */
  ground: [number, number, number] = [.968, .962, .952]
  /** What each colour role looks like: its absorbance per channel. */
  inks: number[][] = Array.from({ length: ROLES }, () => [.5, .5, .5])
  /** How hard the slow curl-noise current runs. */
  drift = .006
  /** How much of the film is left after a second: old ink fades away. */
  fade = 1
  /** How much each swirl is kept alive. */
  vorticity = 9
  /** How fast the water comes to rest, per second. */
  damping = .9
  grain = 0
  /** How big everything is drawn: every size given to the bath is scaled
   *  by it (areas by its square). Sizes are in heights of a landscape bath:
   *  on an upright one they shrink with its width (see `scale`). */
  size = 1.6
  /** What every size given to the bath is scaled by. */
  scale = 1.6

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL2 is not available')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available')
    gl.getExtension('OES_texture_float_linear')
    this.gl = gl
    this.none = this.target(1, 1, gl.NEAREST)
    const vs = this.shader(gl.VERTEX_SHADER, VERT)
    for (const [name, src] of Object.entries(FS)) this.P[name] = this.program(vs, src)
    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.resize()
  }

  private shader(type: number, src: string) {
    const gl = this.gl, s = gl.createShader(type)!
    gl.shaderSource(s, src); gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader')
    return s
  }
  private program(vs: WebGLShader, fs: string): Program {
    const gl = this.gl, p = gl.createProgram()!
    gl.attachShader(p, vs)
    gl.attachShader(p, this.shader(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    const u: Program['u'] = {}
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!
      u[info.name.replace(/\[0\]$/, '')] = { loc: gl.getUniformLocation(p, info.name), type: info.type }
    }
    return { p, u }
  }
  private target(w: number, h: number, filter: number = this.gl.LINEAR): Target {
    const gl = this.gl, tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
    return { tex, fbo, w, h }
  }
  private free(t: Target) { this.gl.deleteTexture(t.tex); this.gl.deleteFramebuffer(t.fbo) }
  private double(w: number, h: number, filter?: number): Double {
    let a = this.target(w, h, filter), b = this.target(w, h, filter)
    return { get read() { return a }, get write() { return b }, swap() { [a, b] = [b, a] }, dispose: () => { this.free(a); this.free(b) } }
  }
  private run(name: string, dst: Target | null, uniforms: Record<string, Uniform> = {}) {
    const gl = this.gl, prog = this.P[name]
    gl.useProgram(prog.p)
    let unit = 0
    for (const [key, val] of Object.entries(uniforms)) {
      const u = prog.u[key]
      if (!u) continue
      switch (u.type) {
        case gl.SAMPLER_2D:
          gl.activeTexture(gl.TEXTURE0 + unit)
          gl.bindTexture(gl.TEXTURE_2D, (val as Target).tex)
          gl.uniform1i(u.loc, unit++)
          break
        case gl.INT: gl.uniform1i(u.loc, val as number); break
        case gl.FLOAT: gl.uniform1f(u.loc, val as number); break
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, val as number[]); break
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, val as number[]); break
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, val as Float32Array); break
        case gl.FLOAT_MAT4x3: gl.uniformMatrix4x3fv(u.loc, false, val as number[]); break
      }
    }
    if (dst) { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.viewport(0, 0, dst.w, dst.h) }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height) }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  resize() {
    const gl = this.gl, canvas = this.canvas
    // No more pixels than the ink film has: more would only be upsampled.
    const cw = canvas.clientWidth, ch = canvas.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, INK_MAX / Math.max(cw, ch, 1), 2)
    const w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr))
    if (w === canvas.width && h === canvas.height && this.film.length) return
    canvas.width = w; canvas.height = h
    this.aspect = w / h
    this.scale = this.size * Math.min(1, this.aspect)
    const s = Math.min(1, INK_MAX / Math.max(w, h))
    const old = this.film.length ? this.film : [null]
    this.film = old.map(o => {
      const layer = this.double(Math.round(w * s), Math.round(h * s))
      if (o) { this.run('copy', layer.read, { uSrc: o.read, uScale: 1 }); o.dispose() }
      return layer
    })
    if (this.aspect >= 1) { this.simW = SIM_LONG; this.simH = Math.round(SIM_LONG / this.aspect) }
    else { this.simH = SIM_LONG; this.simW = Math.round(SIM_LONG * this.aspect) }
    this.vel?.dispose(); this.pres?.dispose()
    if (this.divT) { this.free(this.divT); this.free(this.curlT) }
    this.vel = this.double(this.simW, this.simH)
    this.pres = this.double(this.simW, this.simH, gl.NEAREST)
    this.divT = this.target(this.simW, this.simH, gl.NEAREST)
    this.curlT = this.target(this.simW, this.simH, gl.NEAREST)
    if (this.trayT) this.free(this.trayT)
    this.trayT = this.target(Math.round(128 * Math.min(1, this.aspect)), Math.round(128 / Math.max(1, this.aspect)))
    this.run('tray', this.trayT, { uAspect: this.aspect })
  }
  private trayT?: Target

  // ── what can be done to the water ───────────────────────────────────
  private bx(x: number) { return x * this.aspect }

  /** A drop on the water at (x, y): `area` of ink (a weight per colour
   *  role, all 0 for clear water) spreading out, pushing what is there into a
   *  ring round it. `jag` roughens its edge; type 1 is oily, 2 speckled. */
  drop(x: number, y: number, area: number, ink: readonly number[], o: Partial<Pick<Drop, 'tau' | 'jag' | 'freq' | 'speed' | 'type' | 'delay' | 'held' | 'instant' | 'length'>> = {}) {
    // New ink finishes the skim before it starts spreading.
    if (this.skimming > 0) this.clear()
    const d: Drop = { x: this.bx(x), y, area: area * this.scale ** 2, tau: .25, age: 0, held: false, release: 0, delay: 0, total: 0, ink: [...ink], type: 0, seed: hash(++this.count) * 100, jag: .1, freq: 1, speed: .4, ...o }
    this.drops.push(d)
    return d
  }
  /** Alcohol touched to the water: it clears the film violently, leaving
   *  sparse specks of `ink`, and tears the water along its front. Held
   *  until let go. */
  alcohol(x: number, y: number, area: number, ink: readonly number[]) {
    const d = this.drop(x, y, area, ink, { type: 2, tau: .55, jag: .5, freq: 3, speed: 4, held: true })
    d.alcohol = true
    return d
  }
  /** Isopropyl alcohol touched to the water: in a moment it clears a
   *  patch, its edge torn into fingers, and the fingers' tips curl up into
   *  pairs of tiny eddies. `size` is the patch's radius in heights. With
   *  an `ink` mixed in, the patch is that colour, or only flecked with it. All of
   *  it is a deformation of the film, not of the water, so the curls are as
   *  fine as the ink itself and leave the flow alone. */
  isoprop(x: number, y: number, size: number, ink: readonly number[] = [], speckled = false, delay = 0) {
    const seed = ++this.count, k = this.scale
    // The torn edge keeps its shape while it spreads (`speed: 0`): a shape
    // that changed every frame flickered. Its frequency is a whole number,
    // or the edge does not close round the circle and leaves a seam.
    this.drop(x, y, Math.PI * size * size, ink, { tau: .06, jag: .75, freq: 2 + Math.floor(hash(seed) * 2), speed: 0, type: speckled ? 2 : 0, delay })
    const fingers = 7 + Math.floor(hash(seed * 3) * 7), r = size * k, cx = this.bx(x)
    for (let i = 0; i < fingers; i++) {
      const a = (i + hash(seed * 5 + i) * .6) / fingers * Math.PI * 2, out = r * (.9 + .5 * hash(seed * 7 + i))
      const width = Math.PI * 2 * r / fingers, eddy = width * (.22 + .15 * hash(seed * 11 + i)), turn = 2.5 + 3 * hash(seed * 13 + i)
      // A pair of opposite eddies either side of the finger's tip: a mushroom.
      for (const side of [-1, 1]) {
        const tx = -Math.sin(a) * side * eddy * .9, ty = Math.cos(a) * side * eddy * .9
        this.swirls.push({ x: cx + Math.cos(a) * out + tx, y: y + Math.sin(a) * out + ty, radius: eddy, turn: turn * side, length: .25 + .2 * hash(seed * 17 + i), age: 0, delay: delay + .03 + .05 * hash(seed * 19 + i) })
      }
    }
  }
  /** Move a drop that still wells up, as a brush held to the water and moved. */
  move(d: Drop, x: number, y: number) { d.x = this.bx(x); d.y = y }
  /** Stop a drop at once, as poured so far. */
  stop(d: Drop) { this.drops = this.drops.filter(x => x !== d) }
  /** Is a drop still spreading? */
  spreading(d: Drop) { return this.drops.includes(d) }
  /** Make a drop with a `length` finish spreading within `within` seconds. */
  hurry(d: Drop, within: number) {
    if (!d.length || d.delay > 0) return
    d.pace = Math.max(1, (d.length - d.age) / within)
  }
  /** A held drop's area, unscaled, as given to `drop`. */
  feed(d: Drop, area: number) { d.area = area * this.scale ** 2 }
  /** Let go of a held drop: it stops welling up. */
  let(d: Drop) { if (d.held) { d.held = false; d.release = d.age } }
  /** A pin dragged through the water from (x0, y0) to (x1, y1) in `dt`:
   *  the ink spirals off it. */
  pin(x0: number, y0: number, x1: number, y1: number, dt: number, radius = .007, strength = .9) {
    radius *= this.scale
    const ax = this.bx(x0), bx = this.bx(x1), dx = bx - ax, dy = y1 - y0, dist = Math.hypot(dx, dy)
    const steps = Math.min(16, Math.max(1, Math.ceil(dist / (radius * .5))))
    const vx = dx / Math.max(dt, 1e-4), vy = dy / Math.max(dt, 1e-4)
    for (let i = 1; i <= steps; i++) {
      const f = i / steps
      this.forces.push({ uMode: 1, uP: [ax + dx * f, y0 + dy * f], uDir: [vx, vy], uRadius: radius, uStrength: strength })
    }
  }
  /** A cat's whisker drawn from (x, y) by (dx, dy): combs fine lines
   *  without stirring the water. */
  whisker(x: number, y: number, dx: number, dy: number, width = .0022, shift = 1) {
    width *= this.scale
    if (dx || dy) this.sources.push({ A: [this.bx(x), y, 0, 0], B: [0, 0, 0, 3], C: [dx * this.aspect, dy, width, shift] })
  }
  /** Air blown at the water from (x, y) along (dx, dy), for this frame: a
   *  breath is wide and gusty and makes jagged lines, a straw narrow. */
  blow(x: number, y: number, dx: number, dy: number, strength: number, kind: 'breath' | 'straw' = 'breath') {
    const ax = dx * this.aspect, len = Math.hypot(ax, dy)
    if (len < 1e-6) return
    const dir = [ax / len, dy / len], uP = [this.bx(x), y], k = this.scale
    if (kind === 'breath') this.forces.push({ uMode: 2, uP, uDir: dir, uRadius: .07 * k, uSpread: .55, uLen: .45 * k, uStrength: .9 * strength, uNoise: .7, uNoiseFreq: 30 / k })
    else this.forces.push({ uMode: 2, uP, uDir: dir, uRadius: .012 * k, uSpread: .1, uLen: .7 * k, uStrength: 6 * strength, uNoise: .25, uNoiseFreq: 10 / k })
  }
  /** A nudge: velocity (fx, fy), in heights a second, added in a soft blob. */
  push(x: number, y: number, fx: number, fy: number, radius = .02) {
    this.forces.push({ uMode: 3, uP: [this.bx(x), y], uDir: [fx, fy], uRadius: radius * this.scale })
  }
  /** Flicked from a toothbrush: a spray of fine drops round (x, y). */
  spray(x: number, y: number, ink: readonly number[], n = 30, size = 1, angle = 0) {
    const ca = Math.cos(angle), sa = Math.sin(angle)
    for (let i = 0; i < n; i++) {
      const s = ++this.count, g1 = gauss(s * 3), g2 = gauss(s * 3 + 1)
      const lx = g1 * .07 * size * this.scale, ly = g2 * .03 * size * this.scale
      const r = (.0015 + Math.pow(hash(s * 5), 3) * .011) * size
      this.drop(x + (lx * ca - ly * sa) / this.aspect, y + lx * sa + ly * ca, Math.PI * r * r, ink, { tau: .05 + hash(s * 7) * .1, delay: hash(s * 11) * .12, jag: .12, freq: 2 })
    }
  }

  private spread(dt: number) {
    const keep: Drop[] = []
    for (const d of this.drops) {
      if (d.delay > 0) { d.delay -= dt; keep.push(d); continue }
      if (d.length) {
        // Spread over `length` seconds, slowing evenly to a standstill: the
        // area poured falls off as (1 - t)², so the rings round it coast to
        // a stop instead of halting.
        const p = (t: number) => 1 - (1 - Math.min(1, t / d.length!)) ** 3
        const before = p(d.age)
        d.age += dt * (d.pace ?? 1)
        const dA = d.area * (p(d.age) - before)
        d.total += dA
        if (dA > 1e-9) this.sources.push({ A: [d.x, d.y, dA / Math.PI, d.jag], B: paintOf(d.ink, d.type), C: [d.seed, d.freq, d.speed, 0] })
        if (d.age < d.length) keep.push(d)
        continue
      }
      d.age += dt
      let rate = d.area / d.tau * Math.exp(-d.age / d.tau)
      if (d.held) rate = Math.max(rate, d.area / d.tau * .25)
      else if (d.release) rate *= Math.exp(-(d.age - d.release) / .04)
      // A drop that is let go ends cleanly after three times its spread:
      // what is left is poured at once. A long faint tail would keep
      // pouring tiny fills on the spot, between the drops that follow.
      // An instant drop is poured whole in one frame: poured in steps, each
      // step leaves a faint seam that the next one stretches into a line.
      const ending = d.instant || !d.held && d.age >= d.tau * 3
      const dA = d.instant ? d.area : ending ? Math.max(0, d.release ? 0 : d.area - d.total) : rate * dt
      d.total += dA
      if (dA > 1e-9) this.sources.push({ A: [d.x, d.y, dA / Math.PI, d.jag], B: paintOf(d.ink, d.type), C: [d.seed, d.freq, d.speed, 0] })
      if (d.alcohol && d.held) {
        // The solvent front tears the film: swirls along it.
        const r = Math.sqrt(d.total / Math.PI)
        for (let i = 0; i < 2; i++) {
          const s = ++this.count, a = hash(s) * Math.PI * 2, rr = r * (.85 + hash(s * 3) * .3)
          const k = (hash(s * 5) < .5 ? -1 : 1) * (.05 + hash(s * 7) * .12)
          this.forces.push({ uMode: 3, uP: [d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr], uDir: [-Math.sin(a) * k, Math.cos(a) * k], uRadius: (.015 + hash(s * 9) * .02) * this.scale })
        }
      }
      if (!ending) keep.push(d)
    }
    this.drops = keep
    const ease = (t: number) => t * t * (3 - 2 * t)
    this.swirls = this.swirls.filter(w => {
      if (w.delay > 0) { w.delay -= dt; return true }
      const before = ease(Math.min(1, w.age / w.length))
      w.age += dt
      const now = ease(Math.min(1, w.age / w.length))
      this.sources.push({ A: [w.x, w.y, w.radius, w.turn * (now - before)], B: [0, 0, 0, 4], C: [0, 0, 0, 0] })
      return w.age < w.length
    })
  }

  step(dt: number) {
    if (dt <= 0) return
    this.time += dt
    this.spread(dt)
    const size = [this.simW, this.simH], H = 1 / this.simH, aspect = this.aspect
    this.run('advectVel', this.vel.write, { uVel: this.vel.read, uDt: dt, uAspect: aspect, uDamp: Math.exp(-this.damping * dt), uSnap: .0012 })
    this.vel.swap()
    // The drift is slow and its curl noise costly: it is added every few
    // steps, for the time since the last.
    if (this.drift > 0) {
      this.driftDt += dt
      if (++this.driftN % DRIFT_EVERY === 0) {
        this.forces.push({ uMode: 4, uStrength: this.drift, uDt: this.driftDt })
        this.driftDt = 0
      }
    } else {
      this.driftDt = 0
      this.driftN = 0
    }
    for (const f of this.forces) {
      this.run('force', this.vel.write, { uVel: this.vel.read, uTime: this.time, uDt: dt, uAspect: aspect, uP: [0, 0], uDir: [0, 0], uRadius: .01, uStrength: 0, uNoise: 0, uNoiseFreq: 1, uSpread: 0, uLen: 1, ...f })
      this.vel.swap()
    }
    this.forces = []
    this.run('curl', this.curlT, { uVel: this.vel.read, uSize: size, uH: H })
    this.run('vorticity', this.vel.write, { uVel: this.vel.read, uCurl: this.curlT, uSize: size, uH: H, uEps: this.vorticity, uDt: dt })
    this.vel.swap()
    this.run('divergence', this.divT, { uVel: this.vel.read, uSize: size, uH: H })
    // The solve starts from most of last frame's pressure (a warm start).
    for (let i = 0; i < JACOBI; i++) {
      this.run('jacobi', this.pres.write, { uP: this.pres.read, uDiv: this.divT, uSize: size, uH: H, uKeep: i ? 1 : .8 })
      this.pres.swap()
    }
    this.run('gradient', this.vel.write, { uP: this.pres.read, uVel: this.vel.read, uSize: size, uH: H })
    this.vel.swap()
    this.run('smoothVel', this.vel.write, { uVel: this.vel.read, uSize: size, uK: .5 })
    this.vel.swap()
    // a role above the fourth: the film needs its second layer
    if (this.film.length < 2 && this.sources.some(s => s.B[3] <= 2 && s.B[0] >= 4 && s.B[1] > 0)) {
      const { w, h } = this.film[0].read
      this.film.push(this.double(w, h))
    }
    const inkSize = [this.film[0].read.w, this.film[0].read.h]
    for (const ink of this.film) {
      this.run('advectInk', ink.write, { uInk: ink.read, uVel: this.vel.read, uInkSize: inkSize, uDt: dt, uAspect: aspect, uFade: Math.pow(this.fade, dt) })
      ink.swap()
    }
    const A = new Float32Array(MAXS * 4), B = new Float32Array(MAXS * 4), C = new Float32Array(MAXS * 4)
    for (let i = 0; i < this.sources.length; i += MAXS) {
      const chunk = this.sources.slice(i, i + MAXS)
      A.fill(0); B.fill(0); C.fill(0)
      chunk.forEach((s, j) => { A.set(s.A, j * 4); B.set(s.B, j * 4); C.set(s.C, j * 4) })
      this.film.forEach((ink, layer) => {
        this.run('deform', ink.write, { uInk: ink.read, uInkSize: inkSize, uAspect: aspect, uTime: this.time, uCount: chunk.length, uLayer: layer, uA: A, uB: B, uC: C })
        ink.swap()
      })
    }
    this.sources = []
    if (this.skimming > 0) {
      this.scaleFilm(Math.exp(-dt / .08))
      this.skimming -= dt
      if (this.skimming <= 0) this.clear()
    }
  }

  /** Take off the film: `keep` of it stays (0 clears the bath), and the
   *  water comes to rest. */
  clear(keep = 0) {
    this.skimming = 0
    this.driftDt = 0
    this.driftN = 0
    const gl = this.gl
    if (keep > 0) this.scaleFilm(keep)
    else {
      // a clear bath needs no second layer
      for (const layer of this.film.splice(1)) layer.dispose()
      for (const t of [this.film[0].read, this.film[0].write]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
    }
    for (const t of [this.vel.read, this.vel.write, this.pres.read, this.pres.write]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) }
    this.drops = []; this.swirls = []; this.forces = []; this.sources = []
  }
  private scaleFilm(k: number) {
    for (const ink of this.film) { this.run('copy', ink.write, { uSrc: ink.read, uScale: k }); ink.swap() }
  }
  /** The uniforms that turn the film into absorbance. */
  private absorb() {
    const m = (from: number) => this.inks.slice(from, from + 4).flatMap(c => [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0])
    return { uInk: this.film[0].read, uInk2: this.film[1]?.read ?? this.none, uM0: m(0), uM1: m(4) }
  }
  /** Skim the bath with a strip of paper: the film thins out over a moment
   *  and is gone. */
  skim(seconds = .35) { this.skimming = seconds; this.drops = []; this.swirls = [] }
  private skimming = 0
  /** Lay paper on the water: the picture as the paper takes it up, in the
   *  ink film's resolution. Only a faint ghost stays on the water. */
  print(paper: readonly number[] = [.958, .944, .905], seed = Math.random() * 50) {
    const gl = this.gl, w = this.film[0].read.w, h = this.film[0].read.h
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    this.run('print', { tex, fbo, w, h }, { ...this.absorb(), uInkSize: [w, h], uAspect: this.aspect, uSeed: seed, uPaper: [...paper] })
    const px = new Uint8ClampedArray(w * h * 4)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.deleteTexture(tex); gl.deleteFramebuffer(fbo)
    // readPixels gives the rows bottom first
    const row = w * 4, flipped = new Uint8ClampedArray(px.length)
    for (let y = 0; y < h; y++) flipped.set(px.subarray(y * row, (y + 1) * row), (h - 1 - y) * row)
    this.clear(.06)
    return new ImageData(flipped, w, h)
  }

  private coverT?: Target
  private coverBytes = new Uint8Array(COVER_W * COVER_H * 4)
  /** How much ink lies where, on a grid of 16 by 9 cells, 0 to 1 each,
   *  row by row from the bottom. Read back from the GPU: call it seldom. */
  coverage() {
    const gl = this.gl
    if (!this.coverT) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, COVER_W, COVER_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.coverT = { tex, fbo, w: COVER_W, h: COVER_H }
    }
    this.run('coverage', this.coverT, this.absorb())
    gl.readPixels(0, 0, COVER_W, COVER_H, gl.RGBA, gl.UNSIGNED_BYTE, this.coverBytes)
    const out = new Float32Array(COVER_W * COVER_H)
    for (let i = 0; i < out.length; i++) out[i] = this.coverBytes[i * 4] / 255
    return { cells: out, w: COVER_W, h: COVER_H }
  }

  render() {
    this.run('display', null, { uTray: this.trayT!, ...this.absorb(), uInkSize: [this.film[0].read.w, this.film[0].read.h], uAspect: this.aspect, uGround: this.ground, uGrain: this.grain })
  }
}

/** A drop's paint for the deform shader: its strongest role, how much of
 *  it, and its type. */
function paintOf(ink: readonly number[], type: number) {
  let role = 0
  for (let i = 1; i < ink.length; i++) if (ink[i] > ink[role]) role = i
  return [role, ink[role] ?? 0, 0, type]
}

/** A normally distributed number, from a seed. */
function gauss(seed: number) {
  const u = Math.max(1e-9, hash(seed * 13 + 1)), v = hash(seed * 17 + 2)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
