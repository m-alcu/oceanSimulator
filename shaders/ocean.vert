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

    // ---- Gerstner wave summation ----
    float nx = 0.0, ny = 0.0, nz = 0.0;

    for (int i = 0; i < uWaveCount; i++) {
        float A   = uWave0[i].x * shoalAmp;
        float L   = uWave0[i].y;
        float Q   = uWave0[i].z * shoalQ;
        float spd = uWave0[i].w;
        vec2  D   = normalize(uWave1[i].xy);

        float k  = 2.0 * PI / L;
        float w  = sqrt(G * k) * spd;

        // Prevent Gerstner fold-over: clamp Q so Q*k*A <= 0.9
        float maxQ = (A > 0.0001) ? 0.9 / (k * A) : Q;
        Q = min(Q, maxQ);

        float QA = Q * A;
        float kA = k * A;

        float phase = dot(D, pos.xz) * k - w * uTime;
        float s = sin(phase);
        float c = cos(phase);

        pos.x += QA * D.x * c;
        pos.z += QA * D.y * c;
        pos.y += A  * s;

        nx -= D.x * kA * c;
        ny -= Q   * kA * s;
        nz -= D.y * kA * c;
    }

    vec3 normal = normalize(vec3(nx, 1.0 + ny, nz));

    vWorldPos   = (uModel * vec4(pos, 1.0)).xyz;
    vNormal     = normalize(mat3(uModel) * normal);
    vTexCoord   = aTexCoord;
    vWaveHeight = pos.y;
    vZl         = zl;

    gl_Position = uProj * uView * vec4(vWorldPos, 1.0);
}
