#version 330 core

in vec3  vWorldPos;
in vec3  vNormal;
in vec2  vTexCoord;
in float vZl;       // shore-relative z: negative = ocean side

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uCamPos;
uniform vec3  uShallowColor;
uniform vec3  uDeepColor;
uniform float uTime;
uniform float uWaterLevel;

out vec4 FragColor;

// -----------------------------------------------------------------------
// Smooth value noise — used for caustic network pattern
// -----------------------------------------------------------------------
float chash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.31);
    return fract(p.x * p.y);
}
float cvnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(chash(i),           chash(i + vec2(1,0)), u.x),
               mix(chash(i+vec2(0,1)), chash(i + vec2(1,1)), u.x), u.y);
}

void main() {
    vec3  N     = normalize(vNormal);
    vec3  L     = normalize(uSunDir);
    float h     = vWorldPos.y;
    float slope = 1.0 - abs(N.y);   // 0=flat, 1=vertical

    // ----------------------------------------------------------------
    // Material palette — dry land
    // ----------------------------------------------------------------
    vec3 wetSand  = vec3(0.45, 0.40, 0.27);
    vec3 drySand  = vec3(0.82, 0.76, 0.54);
    vec3 grass    = vec3(0.28, 0.48, 0.16);
    vec3 rock     = vec3(0.42, 0.39, 0.35);
    vec3 darkRock = vec3(0.26, 0.24, 0.22);

    vec3 mat = wetSand;
    mat = mix(mat, drySand, smoothstep(0.0,  3.0,  h));
    // Grass only far inland — coastal zone stays sandy/rocky
    float grassFade = smoothstep(20.0, 40.0, vZl);
    mat = mix(mat, grass,   smoothstep(5.0,  8.0,  h) * grassFade);
    mat = mix(mat, rock,    smoothstep(13.0, 19.0, h));

    // Slope override (cliffs)
    mat = mix(mat, rock,     smoothstep(0.48, 0.62, slope));
    mat = mix(mat, darkRock, smoothstep(0.68, 0.82, slope));

    // ----------------------------------------------------------------
    // Wet-sand strip right at the waterline (vZl -3 .. 2)
    // Darker, more saturated, slightly reflective
    // ----------------------------------------------------------------
    float wetBlend = smoothstep(2.0, -1.0, vZl) * smoothstep(-4.0, -1.5, vZl);
    mat = mix(mat, wetSand * 0.68, wetBlend);

    // ----------------------------------------------------------------
    // Underwater terrain — shade as seafloor seen through water
    // ----------------------------------------------------------------
    // waterDepth: 0 at surface, grows as terrain goes deeper
    float waterDepth = max(0.0, uWaterLevel - h);

    // Absorption: exponential decay of light through water
    // Red channel absorbs fastest, blue slowest
    vec3 absorb = exp(-vec3(0.65, 0.22, 0.05) * waterDepth * 0.35);

    // Seafloor base — fine sand with slight colour variation
    vec3 seafloor = mix(vec3(0.60, 0.55, 0.38),   // light sand
                        vec3(0.28, 0.30, 0.28),    // dark silt/rock
                        smoothstep(0.0, 3.5, waterDepth));

    // Apply water absorption + ambient underwater light colour
    vec3 waterAmbient = mix(uShallowColor, uDeepColor,
                            smoothstep(0.0, 6.0, waterDepth)) * 0.55;
    vec3 underwaterColor = seafloor * absorb + waterAmbient;

    // Caustic network — bright lines along noise isolines (n≈0.5),
    // not a dot grid.  Two layers at different scales/angles cross to
    // form the characteristic irregular light-network of real caustics.
    vec2  cp = vWorldPos.xz * 0.70;
    float ta = uTime * 0.22,  tb = uTime * 0.16;
    float n1 = cvnoise(cp               + vec2( ta,  tb));
    float n2 = cvnoise(cp * 1.55        - vec2( tb, -ta) + vec2(3.3, 1.9));
    // abs(sin(n*π)) peaks at n=0.5 — the "ridge" of the noise field
    float r1 = pow(abs(sin(n1 * 3.14159)), 6.0);
    float r2 = pow(abs(sin(n2 * 3.14159)), 6.0);
    float caustic = (r1 * 0.55 + r2 * 0.45) * 0.22;
    underwaterColor += vec3(0.5, 0.75, 0.6) * caustic
                       * smoothstep(4.0, 0.5, waterDepth);   // only in shallow

    // Blend dry-land material → underwater material across the waterline
    // vZl: 0 = shoreline, -2 = just underwater, -6 = fully submerged
    float submerge = smoothstep(-1.0, -5.0, vZl);
    mat = mix(mat, underwaterColor, submerge);

    // ----------------------------------------------------------------
    // Lighting
    // ----------------------------------------------------------------
    float NdotL  = max(dot(N, L), 0.0);
    float ambient = 0.22;
    // Underwater gets dimmer ambient (light absorbed above)
    float uwa = mix(ambient, ambient * 0.45, submerge);
    float ao  = mix(1.0, 0.72, slope * 0.6);

    vec3 color = mat * (uSunColor * NdotL + uwa) * ao;

    // ----------------------------------------------------------------
    // Fog the underwater terrain so deep areas fade into water colour
    // rather than showing a hard silhouette at the mesh edge.
    // ----------------------------------------------------------------
    vec3 waterFogColor = mix(uShallowColor * 0.55, uDeepColor * 0.45,
                             smoothstep(0.0, 8.0, waterDepth));
    float waterFog = 1.0 - exp(-waterDepth * 0.22);
    color = mix(color, waterFogColor, waterFog * submerge);

    // ----------------------------------------------------------------
    // Alpha — fade the terrain mesh out in deep water so the ocean
    // mesh's opaque water colour takes over cleanly.
    // Below zl = -18 the terrain is invisible (pure ocean colour).
    // ----------------------------------------------------------------
    // Terrain fades out as the ocean mesh takes over in deep water.
    // Must match the ocean's shoreAlpha range (-5 .. -14) so neither
    // mesh is fully invisible at the same depth simultaneously.
    float alpha = 1.0 - smoothstep(-5.0, -18.0, vZl);

    FragColor = vec4(color, alpha);
}
