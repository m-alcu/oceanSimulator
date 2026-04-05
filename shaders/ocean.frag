#version 330 core

in vec3  vWorldPos;
in vec3  vNormal;
in vec2  vTexCoord;
in float vWaveHeight;
in float vZl;          // shore-relative z from vertex shader

uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uShallowColor;
uniform vec3  uDeepColor;
uniform float uFoamThreshold;
uniform float uTime;

out vec4 FragColor;

// -----------------------------------------------------------------------
// Hash + value noise
// -----------------------------------------------------------------------
float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.31);
    return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2  rot = mat2(1.7, 1.2, -1.2, 1.7);
    for (int i = 0; i < 5; i++) {
        v += a * (valueNoise(p) * 2.0 - 1.0);
        p  = rot * p * 2.1;
        a *= 0.48;
    }
    return v;
}

vec3 fbmNormal(vec2 uv, float eps) {
    float hL = fbm(uv + vec2(-eps, 0.0));
    float hR = fbm(uv + vec2( eps, 0.0));
    float hB = fbm(uv + vec2(0.0, -eps));
    float hF = fbm(uv + vec2(0.0,  eps));
    return normalize(vec3(hL - hR, 2.0 * eps, hB - hF));
}

// -----------------------------------------------------------------------
// Fresnel + sky
// -----------------------------------------------------------------------
float fresnel(float cosTheta, float F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 skyColor(vec3 dir) {
    float el     = dir.y;
    vec3 zenith  = vec3(0.08, 0.28, 0.75);
    vec3 horizon = vec3(0.55, 0.73, 0.95);
    vec3 sky     = mix(horizon, zenith, smoothstep(0.0, 0.45, max(el, 0.0)));

    // Sun — same disk/corona parameters as sky.frag so reflections match
    float sunDot  = max(dot(dir, uSunDir), 0.0);
    float sunDisk = smoothstep(0.9994, 1.0,   sunDot);
    float corona  = smoothstep(0.9975, 0.9994, sunDot) * 0.75;
    float sunGlow = pow(sunDot, 7.0) * 0.65;
    float sunHaze = pow(sunDot, 22.0) * 0.35;

    sky += uSunColor * sunDisk * 6.0;
    sky += uSunColor * vec3(1.0, 0.92, 0.70) * corona;
    sky += uSunColor * vec3(1.0, 0.80, 0.45) * sunGlow;
    sky += uSunColor * sunHaze;
    return sky;
}

// -----------------------------------------------------------------------
// Beach swash: one animated foam tongue
//   t        — phase in [0,1] within the wave's period
//   x        — world x, for irregular along-shore variation
//   returns  — (foamZl, width, brightness)
//              foamZl   = where the foam front is in shore-relative z
//              width    = gaussian half-width of the foam strip
//              bright   = foam brightness (0=none, 1=white)
// -----------------------------------------------------------------------
void swashWave(float t, float x, float phaseX,
               out float foamZl, out float width, out float bright) {
    // Irregular along-shore timing: each point on the shore receives the
    // wave slightly earlier or later — simulates an angled wave front.
    float xShift = sin(x * 0.05 + phaseX) * 3.5
                 + sin(x * 0.13 + phaseX * 2.1) * 1.2;
    float tLocal = fract(t + xShift * 0.02);

    if (tLocal < 0.42) {
        // --- Approach: wave crest travels from deep (-22) to break (-2) ---
        float s  = tLocal / 0.42;
        s        = s * s * (3.0 - 2.0 * s);   // smoothstep
        foamZl   = mix(-22.0, -2.0, s);
        width    = 2.8 - s * 0.8;              // narrows as it steepens
        bright   = 0.55 + s * 0.35;            // brightens at break
    } else if (tLocal < 0.56) {
        // --- Breaking + run-up: foam surges up the beach ---
        float s  = (tLocal - 0.42) / 0.14;
        s        = sqrt(s);                    // fast start, slows at top
        foamZl   = mix(-2.0, 10.0, s);
        width    = 1.4 + s * 0.6;
        bright   = mix(0.90, 0.70, s);
    } else {
        // --- Recession: sheet of foam pulls back down the beach ---
        float s  = (tLocal - 0.56) / 0.44;
        s        = s * s;                      // accelerates as it drains
        foamZl   = mix(10.0, -4.0, s);
        width    = 1.0 + (1.0 - s) * 1.5;
        bright   = (1.0 - s) * 0.55;
    }
}

void main() {
    // ----------------------------------------------------------------
    // Composite normal: Gerstner macro + FBM micro-chop
    // ----------------------------------------------------------------
    vec3 macroN = normalize(vNormal);

    vec2  uv1   = vWorldPos.xz * 0.042 + vec2( 0.12,  0.07) * uTime;
    vec2  uv2   = vWorldPos.xz * 0.091 + vec2(-0.09,  0.14) * uTime;
    vec3  chopA = fbmNormal(uv1, 0.5);
    vec3  chopB = fbmNormal(uv2, 0.5);

    float dist      = length(vWorldPos.xz - uCamPos.xz);
    float chopBlend = 0.28 * (1.0 - smoothstep(30.0, 120.0, dist));

    vec3 N = normalize(macroN + chopA * chopBlend + chopB * chopBlend * 0.5);

    // ----------------------------------------------------------------
    // Lighting setup
    // ----------------------------------------------------------------
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(V + L);

    float NdotV = max(dot(N, V), 0.0);
    float NdotH = max(dot(N, H), 0.0);

    // ----------------------------------------------------------------
    // Water colour — gets more turquoise / shallow near shore
    // ----------------------------------------------------------------
    float depthBlend = clamp(vWaveHeight * 0.25 + 0.5, 0.0, 1.0);
    vec3  waterColor = mix(uDeepColor, uShallowColor, depthBlend);

    // Extra tint in the shallow shore zone — kept subtle and blue-leaning
    float shoreBlend = smoothstep(-30.0, -2.0, vZl);
    waterColor = mix(waterColor, vec3(0.05, 0.50, 0.65), shoreBlend * 0.25);

    float distBlend = 1.0 - exp(-dist * 0.004);
    waterColor = mix(waterColor, uDeepColor, distBlend * 0.45);

    // ----------------------------------------------------------------
    // Fresnel + reflection
    // ----------------------------------------------------------------
    // F0 = 0.04 is physically correct for water; we add a small artistic
    // boost (0.06) so the sky/sun reflection is visible at moderate angles.
    float F     = fresnel(NdotV, 0.06);
    vec3  R     = reflect(-V, N);
    vec3  refl  = skyColor(R);
    // Blend: deep colour → sky reflection as F grows with viewing angle
    vec3  color = mix(waterColor, refl, F);

    // ----------------------------------------------------------------
    // Specular — three lobes so the sun forms a visible golden path
    // ----------------------------------------------------------------
    float NdotL    = max(dot(N, L), 0.0);
    float spec     = pow(NdotH, 512.0) * F;           // razor-sharp glint
    float specMid  = pow(NdotH,  80.0) * F * 0.40;   // sun column sparkle
    float specWide = pow(NdotH,  18.0) * F * 0.12;   // broad scattered halo
    color += uSunColor * (spec * 1.4 + specMid + specWide) * max(NdotL, 0.15);

    // ----------------------------------------------------------------
    // Subsurface scatter
    // ----------------------------------------------------------------
    float scatter = max(dot(H, L), 0.0) * max(vWaveHeight * 0.25, 0.0);
    color += vec3(0.0, 0.28, 0.22) * scatter * uSunColor;

    // ----------------------------------------------------------------
    // Open-ocean crest foam
    // ----------------------------------------------------------------
    float foamNoise = valueNoise(vWorldPos.xz * 0.15 + uTime * 0.12) * 0.6
                    + valueNoise(vWorldPos.xz * 0.38 - uTime * 0.08) * 0.4;
    float foamH = vWaveHeight - foamNoise * 0.4;
    float foam  = smoothstep(uFoamThreshold * 0.75, uFoamThreshold * 1.1, foamH);
    color = mix(color, vec3(1.0), foam * 0.90);

    // ----------------------------------------------------------------
    // Beach swash waves
    // ----------------------------------------------------------------
    // 5 wave trains, each with a different period, phase, and x-offset
    // so they feel independent rather than in lockstep.
    // Periods / phases / x-phase shifts:
    const float P[5]  = float[5](8.2,  10.5, 6.9,  12.1, 7.6 );
    const float PH[5] = float[5](0.0,   2.3, 4.7,   1.1, 6.0 );
    const float XP[5] = float[5](0.0,   1.9, 3.7,   5.5, 7.3 );

    float beachFoam = 0.0;

    for (int i = 0; i < 5; i++) {
        float t = fract((uTime + PH[i]) / P[i]);

        float foamZl, width, bright;
        swashWave(t, vWorldPos.x, XP[i], foamZl, width, bright);

        // Gaussian strip centred at foamZl in shore-relative space
        float d     = vZl - foamZl;
        float strip = exp(-d * d / (width * width)) * bright;

        // Only active in the shore zone — kill it in deep ocean and far inland
        strip *= smoothstep(-26.0, -16.0, vZl);   // fade in from deep
        strip *= smoothstep(14.0,   8.0,  vZl);   // fade on dry land

        // Natural x-variation: noise breaks perfect along-shore uniformity
        float xNoise = valueNoise(vec2(vWorldPos.x * 0.07 + XP[i], uTime * 0.18 + PH[i]));
        strip *= 0.5 + xNoise * 0.7;

        beachFoam = max(beachFoam, strip);
    }

    // Slightly yellow-white foam (sunlit bubbles), not pure white
    vec3 foamColor = mix(vec3(1.0, 0.98, 0.93), vec3(0.88, 0.94, 0.96),
                         smoothstep(-2.0, 8.0, vZl));   // warmer at break, cooler on sand
    color = mix(color, foamColor, clamp(beachFoam, 0.0, 1.0));

    // ----------------------------------------------------------------
    // Atmospheric haze
    // ----------------------------------------------------------------
    float haze = 1.0 - exp(-dist * 0.0025);
    color = mix(color, vec3(0.62, 0.78, 0.93), haze * 0.30);

    // ----------------------------------------------------------------
    // Alpha — depth-based translucency + shore fade
    //
    // The terrain shader already renders the seafloor with underwater
    // colour/caustics/fog.  The ocean mesh only needs to sit on top as
    // a translucent water surface; it must vanish completely before the
    // terrain rises above sea level so it never pokes through the ground.
    //
    // Handoff budget (vZl, shore-relative):
    //   < -18  : ocean fully opaque   (terrain invisible below)
    //   -18..-10 : both blend (terrain fades in from its own alpha)
    //   -10..-5  : ocean fades out    (terrain's underwater shading visible)
    //   > -5   : ocean gone           (no geometry intersection possible)
    //
    // depthOpacity: exponential absorption so shallow water is clear.
    //   Keyed on -vZl because deeper (more negative vZl) = more water above.
    float approxDepth  = max(0.0, -vZl);
    float depthOpacity = 1.0 - exp(-approxDepth * 0.13);  // 0=crystal, 1=opaque
    float shoreAlpha   = smoothstep(-5.0, -14.0, vZl);    // gone by vZl=-5
    float alpha        = shoreAlpha * mix(0.15, 1.0, depthOpacity);

    FragColor = vec4(color, alpha);
}
