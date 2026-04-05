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

    float el = dir.y;   // elevation: -1 below, +1 above

    // Sky gradient
    vec3 zenith  = vec3(0.08, 0.26, 0.72);
    vec3 midSky  = vec3(0.25, 0.52, 0.88);
    vec3 horizon = vec3(0.58, 0.76, 0.96);
    vec3 ground  = vec3(0.32, 0.38, 0.40);

    vec3 sky;
    if (el >= 0.0) {
        sky = mix(horizon, midSky, smoothstep(0.0, 0.15, el));
        sky = mix(sky,     zenith, smoothstep(0.15, 0.55, el));
    } else {
        sky = mix(ground, horizon, smoothstep(-0.08, 0.0, el));
    }

    // Sun disk + corona
    float sunDot    = max(dot(dir, uSunDir), 0.0);
    float sunDisk   = smoothstep(0.9994, 1.0,   sunDot);          // hot white disk
    float corona    = smoothstep(0.9975, 0.9994, sunDot) * 0.75;  // warm inner ring
    float sunGlow   = pow(sunDot, 7.0) * 0.65;                    // broad golden glow
    float sunHaze   = pow(sunDot, 22.0) * 0.35;                   // tight haze

    sky += uSunColor * sunDisk * 6.0;
    sky += uSunColor * vec3(1.0, 0.92, 0.70) * corona;
    sky += uSunColor * vec3(1.0, 0.80, 0.45) * sunGlow;
    sky += uSunColor * sunHaze;

    // Soft horizon brightening
    float hazeStrip = exp(-abs(el) * 7.0) * 0.12;
    sky += horizon * hazeStrip;

    FragColor = vec4(sky, 1.0);
}
