#version 330 core

layout(location = 0) in vec3 aPos;
layout(location = 2) in vec2 aTexCoord;

uniform mat4  uModel;
uniform mat4  uView;
uniform mat4  uProj;
uniform float uTime;
uniform int   uWaveCount;
uniform float uWaterLevel;

// Each vec4: (amplitude, wavelength, steepness, speed)
uniform vec4 uWave0[8];
// Each vec4: (dirX, dirZ, 0, 0)
uniform vec4 uWave1[8];

out vec3  vWorldPos;
out vec3  vNormal;
out vec2  vTexCoord;
out float vWaveHeight;
out float vZl;         // shore-relative z: <0 ocean, >0 land

const float PI = 3.14159265;
const float G  = 9.81;

// -----------------------------------------------------------------------
// Value noise + FBM — used to break Gerstner periodicity
// -----------------------------------------------------------------------
float hashv(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.31);
    return fract(p.x * p.y);
}

float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hashv(i),             hashv(i + vec2(1,0)), u.x),
               mix(hashv(i + vec2(0,1)), hashv(i + vec2(1,1)), u.x), u.y);
}

// Returns a signed (-1..1) height displacement with several octaves.
// Two differently-rotated copies are summed so no axis alignment is visible.
float fbmOcean(vec2 p) {
    float v = 0.0, a = 0.5;
    // 30° and 70° rotation matrices baked as constants
    mat2 r1 = mat2( 0.866, 0.5,  -0.5,  0.866);   // 30°
    mat2 r2 = mat2( 0.342, 0.940,-0.940, 0.342);   // 70°
    for (int i = 0; i < 6; i++) {
        v += a * (vnoise(p)           * 2.0 - 1.0);
        v += a * (vnoise(r2 * p * 1.3) * 2.0 - 1.0) * 0.6;
        p  = r1 * p * 2.07;
        a *= 0.48;
    }
    return v;   // roughly -1..1
}

// Finite-difference normal of the FBM field
vec3 fbmNormalOcean(vec2 p, float eps) {
    float hL = fbmOcean(p + vec2(-eps, 0.0));
    float hR = fbmOcean(p + vec2( eps, 0.0));
    float hB = fbmOcean(p + vec2(0.0, -eps));
    float hF = fbmOcean(p + vec2(0.0,  eps));
    return normalize(vec3(hL - hR, 2.0 * eps, hB - hF));
}

// Same formula as C++ shorelineZ() and ocean.frag — must stay in sync
float shorelineZv(float x) {
    return sin(x * 0.018)       * 9.0
         + sin(x * 0.041 - 1.3) * 4.5
         + sin(x * 0.089 + 2.1) * 2.0
         + sin(x * 0.170 - 0.6) * 0.9;
}

void main() {
    vec3 pos = aPos;
    pos.y += uWaterLevel;

    // ---- Shoaling: compute before Gerstner loop (uses rest position) ----
    float sz = shorelineZv(pos.x);
    float zl = pos.z - sz;

    // shoalAmp: wave amplitude scaling with depth proxy
    //   deep ocean (zl < -55)  → 1.0 (no shoaling)
    //   approaching (zl -55→-10) → ramps up to 1.8 (waves grow)
    //   break zone (zl -10→-2)  → collapses to 0 (wave breaks)
    //   shore (zl > -2)          → 0 (flat — foam takes over)
    float shoalAmp, shoalQ;
    if (zl > -2.0) {
        shoalAmp = 0.0;
        shoalQ   = 0.0;
    } else if (zl > -10.0) {
        float t  = (-zl - 2.0) / 8.0;   // 0 at shore, 1 at zl=-10
        t        = t * t * (3.0 - 2.0 * t);
        shoalAmp = t * 1.8;
        shoalQ   = t;
    } else if (zl > -55.0) {
        float t  = (-zl - 10.0) / 45.0; // 0 at zl=-10, 1 at zl=-55
        shoalAmp = mix(1.8, 1.0, t);
        shoalQ   = 1.0;
    } else {
        shoalAmp = 1.0;
        shoalQ   = 1.0;
    }

    // ---- Phase-domain warp — curves wave crests from straight lines ----
    // Sample two slow FBM fields and use them as a 2D offset applied to the
    // phase sample point.  A warp of magnitude W bends crest curvature by
    // roughly W/L radians/unit — enough to turn plane waves into arcs.
    //
    // Two warp layers at different scales + speeds so large swells and small
    // chop curve independently.
    float warpScaleA = 0.013, warpScaleB = 0.031;
    vec2  wpA = pos.xz * warpScaleA + vec2(0.007,  0.011) * uTime;
    vec2  wpB = pos.xz * warpScaleB + vec2(-0.019, 0.008) * uTime + vec2(7.3, 2.9);

    // Domain-warp: B sampled at A-warped coords to break symmetry further
    float wA0 = fbmOcean(wpA);
    float wA1 = fbmOcean(wpA + vec2(3.7, 1.4));
    vec2  warpA = vec2(wA0, wA1) * 18.0;           // large-scale crest bending

    vec2  wpBw = wpB + vec2(wA0 * 2.1, wA1 * 1.6); // B warped by A
    float wB0 = fbmOcean(wpBw);
    float wB1 = fbmOcean(wpBw + vec2(2.1, 5.8));
    vec2  warpB = vec2(wB0, wB1) * 7.0;            // fine-scale crest irregularity

    // ---- Gerstner wave summation with warped phase ----
    float nx = 0.0, ny = 0.0, nz = 0.0;

    for (int i = 0; i < uWaveCount; i++) {
        float A   = uWave0[i].x * shoalAmp;
        float L   = uWave0[i].y;
        float Q   = uWave0[i].z * shoalQ;
        float spd = uWave0[i].w;
        vec2  D   = normalize(uWave1[i].xy);

        float k  = 2.0 * PI / L;
        float w  = sqrt(G * k) * spd;

        float maxQ = (A > 0.0001) ? 0.9 / (k * A) : Q;
        Q = min(Q, maxQ);

        float QA = Q * A;
        float kA = k * A;

        // Warp blends: long waves bend more from the large warp,
        // short chop bends more from the fine warp.
        float longT  = smoothstep(8.0, 45.0, L);
        vec2  warp   = mix(warpB, warpA, longT);

        // Warped phase sample — this is what curves the crests
        vec2  pSample = pos.xz + warp;
        float phase = dot(D, pSample) * k - w * uTime;
        float s = sin(phase);
        float c = cos(phase);

        pos.x += QA * D.x * c;
        pos.z += QA * D.y * c;
        pos.y += A  * s;

        nx -= D.x * kA * c;
        ny -= Q   * kA * s;
        nz -= D.y * kA * c;
    }

    vec3 gerstnerNormal = normalize(vec3(nx, 1.0 + ny, nz));

    // ---- FBM swell — breaks the periodic tiling of Gerstner waves ----
    // Three overlapping FBM layers at different scales and drift speeds.
    // The domain-warp offset (layer b sampling at a's position) destroys
    // any remaining axis-aligned regularity.
    float fbmScale  = 0.028;
    vec2  pa = pos.xz * fbmScale        + vec2( 0.031,  0.019) * uTime;
    vec2  pb = pos.xz * fbmScale * 1.7  + vec2(-0.024,  0.037) * uTime + vec2(5.3, 2.1);
    vec2  pc = pos.xz * fbmScale * 0.6  + vec2( 0.013, -0.028) * uTime + vec2(1.7, 8.4);

    // Domain warp: sample b at position warped by a
    float wa = fbmOcean(pa);
    vec2  warpedB = pb + vec2(wa * 2.5, wa * 1.8);
    float wb = fbmOcean(warpedB);
    float wc = fbmOcean(pc);

    // Scale: large-scale swell (wc), medium rolling (wa), fine chop (wb)
    // All killed near shore so they don't fight the shoaling/break logic
    float offshoreBlend = smoothstep(-8.0, -22.0, zl);
    float fbmY = (wc * 0.55 + wa * 0.30 + wb * 0.15)
                 * 1.8                    // total FBM amplitude (world units)
                 * shoalAmp * 0.6         // shoaling modulates FBM too
                 * offshoreBlend;

    pos.y += fbmY;

    // Recompute normal: blend Gerstner analytic normal with FBM finite-diff normal
    float fnbScale = fbmScale;
    vec3  fbmN = fbmNormalOcean(pos.xz * fnbScale + vec2(0.031, 0.019) * uTime, 0.8);
    // Weight: FBM normal strongest in deep open water, Gerstner near shore
    float fbmNWeight = 0.75 * offshoreBlend;
    vec3  normal = normalize(gerstnerNormal + fbmN * fbmNWeight);

    vWorldPos   = (uModel * vec4(pos, 1.0)).xyz;
    vNormal     = normalize(mat3(uModel) * normal);
    vTexCoord   = aTexCoord;
    vWaveHeight = pos.y;
    vZl         = zl;

    gl_Position = uProj * uView * vec4(vWorldPos, 1.0);
}
