#version 330 core

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vTexCoord;
// Shore-relative z (same formula as ocean shaders) — negative = ocean side
out float vZl;

// Keep in sync with ocean shaders and terrain_mesh.hpp
float shorelineZt(float x) {
    return sin(x * 0.018)        * 9.0
         + sin(x * 0.041 - 1.3) * 4.5
         + sin(x * 0.089 + 2.1) * 2.0
         + sin(x * 0.170 - 0.6) * 0.9;
}

void main() {
    vWorldPos   = (uModel * vec4(aPos, 1.0)).xyz;
    vNormal     = normalize(mat3(uModel) * aNormal);
    vTexCoord   = aTexCoord;
    vZl         = aPos.z - shorelineZt(aPos.x);
    gl_Position = uProj * uView * vec4(vWorldPos, 1.0);
}
