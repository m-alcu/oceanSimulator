#version 330 core

in vec2 vNDC;

uniform vec3  uCamForward;
uniform vec3  uCamRight;
uniform vec3  uCamUp;
uniform float uFovTan;
uniform float uAspect;
uniform vec3  uSunDir;
uniform vec3  uSunColor;

out vec4 FragColor;

void main() {
    // Reconstruct world-space ray direction for this fragment
    vec3 dir = normalize(
        uCamForward
        + uCamRight * (vNDC.x * uAspect * uFovTan)
        + uCamUp    * (vNDC.y * uFovTan)
    );

    float el     = dir.y;
    float sunElev = uSunDir.y;   // -1..1, 0 = horizon

    // ----------------------------------------------------------------
    // Sky palette — blends from midday blue to sunset orange/red
    // as the sun descends toward the horizon
    // ----------------------------------------------------------------
    float sunsetT = 1.0 - smoothstep(-0.05, 0.30, sunElev);   // 1 at sunset, 0 at midday

    // Midday colours
    vec3 zenith_day   = vec3(0.08, 0.26, 0.72);
    vec3 midSky_day   = vec3(0.25, 0.52, 0.88);
    vec3 horizon_day  = vec3(0.58, 0.76, 0.96);

    // Sunset colours
    vec3 zenith_set   = vec3(0.05, 0.10, 0.28);
    vec3 midSky_set   = vec3(0.38, 0.20, 0.12);
    vec3 horizon_set  = vec3(0.92, 0.42, 0.08);

    vec3 zenith  = mix(zenith_day,  zenith_set,  sunsetT);
    vec3 midSky  = mix(midSky_day,  midSky_set,  sunsetT);
    vec3 horizon = mix(horizon_day, horizon_set, sunsetT);
    vec3 ground  = vec3(0.20, 0.15, 0.12);

    vec3 sky;
    if (el >= 0.0) {
        sky = mix(horizon, midSky, smoothstep(0.0, 0.15, el));
        sky = mix(sky,     zenith, smoothstep(0.15, 0.55, el));
    } else {
        sky = mix(ground, horizon, smoothstep(-0.08, 0.0, el));
    }

    // ----------------------------------------------------------------
    // Horizon glow band in the direction of the sun (sunset/sunrise)
    // A horizontal strip of warm colour centred on the sun's azimuth.
    // ----------------------------------------------------------------
    vec2  sunAz    = normalize(uSunDir.xz + vec2(1e-5));  // sun azimuth direction
    float azAlign  = max(dot(dir.xz / (length(dir.xz) + 1e-5), sunAz), 0.0);
    float glowBand = exp(-abs(el) * 5.0)                  // narrow vertical band
                   * pow(azAlign, 3.0)                    // aligned with sun azimuth
                   * sunsetT * 1.6;
    sky += uSunColor * vec3(1.0, 0.45, 0.05) * glowBand;

    // Soft general horizon brightening
    float hazeStrip = exp(-abs(el) * 7.0) * mix(0.10, 0.22, sunsetT);
    sky += mix(horizon_day, horizon_set, sunsetT) * hazeStrip;

    // ----------------------------------------------------------------
    // Sun disk — large, round, with limb darkening + corona
    // sunDot uses true dot (not clamped) so disk renders at any elevation
    // ----------------------------------------------------------------
    float sunDot = dot(dir, uSunDir);

    // Disk size: ~3.5° radius (real sun ~0.25°, but visible and satisfying)
    float diskEdge  = 0.9982;   // cos(3.5°) ≈ 0.9982
    float diskHot   = 0.9993;   // cos(2.1°) inner bright core
    float sunDisk   = smoothstep(diskEdge, diskHot, sunDot);

    // Limb darkening: centre is white-hot, edge tints toward sun colour
    float limbT     = smoothstep(diskEdge, 1.0, sunDot);   // 0 at edge, 1 at centre
    vec3  diskColor = mix(uSunColor * 0.85, vec3(1.0, 0.98, 0.90), limbT);

    // Corona rings
    float corona1 = smoothstep(0.9960, diskEdge, sunDot) * 0.80;  // inner ring
    float corona2 = smoothstep(0.9920, 0.9960,   sunDot) * 0.40;  // outer ring

    // Sun glow — broad diffuse halo, stronger at low elevation (Rayleigh scattering)
    float scatterScale = mix(7.0, 18.0, sunsetT);  // wider glow at sunset
    float sunGlow  = pow(max(sunDot, 0.0), scatterScale) * mix(0.55, 1.2, sunsetT);
    float sunHaze  = pow(max(sunDot, 0.0), 40.0) * 0.30;

    sky += diskColor * sunDisk * 8.0;
    sky += uSunColor * vec3(1.0, 0.88, 0.65) * corona1;
    sky += uSunColor * vec3(1.0, 0.72, 0.35) * corona2;
    sky += uSunColor * vec3(1.0, 0.70, 0.30) * sunGlow;
    sky += uSunColor * sunHaze;

    FragColor = vec4(sky, 1.0);
}
