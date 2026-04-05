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
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);

    float approxDepth = max(0.0, -vZl);

    // ----------------------------------------------------------------
    // Water body tint — scattering of the water column.
    // Real water has NO intrinsic bright blue in the shallows — that
    // comes from the seafloor showing through (handled by alpha).
    // Only deep water has its own colour from volumetric scattering.
    // ----------------------------------------------------------------
    float depthT   = 1.0 - exp(-approxDepth * 0.07);
    vec3 waterBody = mix(
        vec3(0.016, 0.085, 0.11),    // shallow: barely tinted, near-clear
        uDeepColor * 0.55,            // deep: colour param, dimmed by absorption
        depthT
    );

    // ----------------------------------------------------------------
    // Fresnel — physically correct F0=0.04.
    // At grazing angle (NdotV→0) F→1: pure mirror.
    // Looking straight down (NdotV=1) F=0.04: almost transparent.
    // ----------------------------------------------------------------
    float F    = fresnel(NdotV, 0.04);
    vec3  R    = reflect(-V, N);
    vec3  refl = skyColor(R);

    // Base: transparent water body + sky/sun mirror via Fresnel
    vec3 color = mix(waterBody, refl, F);

    // ----------------------------------------------------------------
    // Specular — sun disk sharply reflected in wave facets
    // ----------------------------------------------------------------
    float spec = pow(NdotH, 450.0);
    color += uSunColor * spec * 2.5;

    // ----------------------------------------------------------------
    // Sun glitter path + rays
    //
    // Rays on real water are wave-group bands seen from above:
    // crests/troughs create alternating reflective corridors that
    // appear as parallel bright fingers running AWAY from the camera
    // toward the sun's horizon point.
    //
    // We model this as:
    //   pathMask  — cone from camera toward sun's horizontal projection
    //   sparkle   — noise-based dancing facets along the path
    //   rays      — lateral (across-path) sine bands with noise warping,
    //               which project as spokes radiating from the camera
    // ----------------------------------------------------------------
    vec2 sunH    = normalize(uSunDir.xz + vec2(1e-5));
    vec2 sunPerp = vec2(-sunH.y, sunH.x);

    vec2  toFrag   = vWorldPos.xz - uCamPos.xz;
    float fragDist = length(toFrag) + 0.01;

    float alongPath  = dot(toFrag / fragDist, sunH);
    float acrossPath = dot(toFrag, sunPerp);
    // Path narrows toward horizon (perspective convergence)
    float normAcross = acrossPath / (sqrt(fragDist) * 4.2 + 1.0);
    float pathMask   = smoothstep(0.30, 0.88, alongPath)
                     * exp(-normAcross * normAcross * 0.65);

    // Sparkle: two noise layers at different speeds — bright only when both peak
    vec2 d1 = sunH * uTime * 2.6  + sunPerp * uTime * 0.25;
    vec2 d2 = sunH * uTime * 1.4  - sunPerp * uTime * 0.45 + vec2(4.1, 1.7);
    float s1 = valueNoise(vWorldPos.xz * 1.3 + d1);
    float s2 = valueNoise(vWorldPos.xz * 2.5 - d2);
    float sparkle = pow(s1 * s2, 2.4) * 4.0;   // rare, intense flashes

    // Rays: bands across the path (= radial spokes in perspective).
    // Two noise layers warp the band phase so they look organic, not ruled.
    float bandCoord = dot(toFrag, sunPerp);
    float bn1 = (valueNoise(vec2(bandCoord * 0.055,        uTime * 0.11 + 1.7)) - 0.5) * 4.0;
    float bn2 = (valueNoise(vec2(bandCoord * 0.130 + 5.3,  uTime * 0.07       )) - 0.5) * 2.5;
    // sin with noise phase → irregular spacing; pow sharpens peaks
    float rays = pow(max(0.0, sin(bandCoord * 0.25 + bn1 + bn2)), 3.5)
               * smoothstep(0.0, 15.0, fragDist);   // fade at camera feet

    // Sun elevation: low sun = long dramatic path; overhead = compact patch
    float sunElev   = clamp(uSunDir.y, 0.02, 1.0);
    float elevScale = smoothstep(0.02, 0.18, sunElev) * (1.0 - sunElev * 0.38);

    float glitter = pathMask * (sparkle * 0.60 + rays * 0.40) * elevScale;
    color += uSunColor * vec3(1.0, 0.93, 0.68) * glitter * 2.4;

    // ----------------------------------------------------------------
    // Subsurface scatter — backlit translucent wave crests
    // ----------------------------------------------------------------
    float scatter = max(dot(H, L), 0.0) * max(vWaveHeight * 0.2, 0.0);
    color += vec3(0.02, 0.14, 0.12) * scatter * uSunColor;

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
    float depthOpacity = 1.0 - exp(-approxDepth * 0.13);  // 0=crystal, 1=opaque
    float shoreAlpha   = smoothstep(-5.0, -14.0, vZl);    // gone by vZl=-5
    float alpha        = shoreAlpha * mix(0.15, 1.0, depthOpacity);

    FragColor = vec4(color, alpha);
}
