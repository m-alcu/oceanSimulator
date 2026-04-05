#pragma once
#include <vector>
#include <cmath>
#include "renderer/mesh.hpp"

// -----------------------------------------------------------------------
// Smooth value noise — no cone artifacts, no sharp edges
// -----------------------------------------------------------------------
static float hash2(float x, float y) {
    float a = x * 127.1f + y * 311.7f;
    float b = x * 269.5f + y * 183.3f;
    // Squish + fract
    a = a - std::floor(a / 1e5f) * 1e5f;
    b = b - std::floor(b / 1e5f) * 1e5f;
    float v = std::sin(a) * 43758.5f + std::sin(b) * 22578.1f;
    return v - std::floor(v);
}

static float valueNoise2(float x, float y) {
    float ix = std::floor(x), iy = std::floor(y);
    float fx = x - ix,        fy = y - iy;
    // Quintic smoothstep  (no derivative discontinuity)
    float ux = fx * fx * fx * (fx * (fx * 6.f - 15.f) + 10.f);
    float uy = fy * fy * fy * (fy * (fy * 6.f - 15.f) + 10.f);
    float v00 = hash2(ix,       iy      );
    float v10 = hash2(ix + 1.f, iy      );
    float v01 = hash2(ix,       iy + 1.f);
    float v11 = hash2(ix + 1.f, iy + 1.f);
    return v00 + (v10 - v00) * ux
               + (v01 - v00) * uy
               + (v00 - v10 - v01 + v11) * ux * uy;
}

// FBM — octaves of value noise with optional rotation to break axis alignment
static float fbm(float x, float y, int octaves, float lacunarity = 2.1f, float gain = 0.5f) {
    float v = 0.f, a = 0.5f;
    // Small rotation each octave
    const float cs = 0.8660f, sn = 0.5f;  // 30°
    for (int i = 0; i < octaves; i++) {
        v += a * valueNoise2(x, y);
        // Rotate + scale
        float nx = cs * x - sn * y;
        float ny = sn * x + cs * y;
        x = nx * lacunarity;
        y = ny * lacunarity;
        a *= gain;
    }
    return v;  // roughly 0..1
}

// -----------------------------------------------------------------------
// Shoreline curve — coves and headlands
// -----------------------------------------------------------------------
static float shorelineZ(float x) {
    return std::sin(x * 0.018f        ) * 9.0f
         + std::sin(x * 0.041f - 1.3f) * 4.5f
         + std::sin(x * 0.089f + 2.1f) * 2.0f
         + std::sin(x * 0.170f - 0.6f) * 0.9f;
}

// -----------------------------------------------------------------------
// Terrain height.  zl = signed distance from the irregular shoreline.
// -----------------------------------------------------------------------
static float terrainH(float x, float z) {
    float sz = shorelineZ(x);
    float zl = z - sz;

    // ---- Underwater: sloped seafloor with smooth noise bumps ----
    if (zl < -1.0f) {
        float h = zl * 0.09f;
        // 3-octave FBM for sandy/rocky seabed — no cones possible
        h += (fbm(x * 0.08f, z * 0.08f, 3) - 0.5f) * 1.2f;
        return h;
    }

    // ---- Base slope rising from shore ----
    // Smoothstep avoids a linear crease right at the waterline
    float rise = std::min(zl / 18.f, 1.f);
    rise = rise * rise * (3.f - 2.f * rise);   // smoothstep
    float h = rise * 2.8f;

    // ---- Coastal rocks: multiple-frequency FBM, never cones ----
    // Active only in the shore zone (zl -5 .. 20)
    if (zl < 20.f) {
        float zoneFade = 1.f - std::max(0.f, (zl - 5.f) / 15.f);
        zoneFade = zoneFade * zoneFade;
        // Domain-warp: offset the sample point by a lower-freq noise to
        // make shapes irregular/stretched rather than round.
        float wx = fbm(x * 0.07f + 1.7f, z * 0.07f + 3.1f, 2) - 0.5f;
        float wz = fbm(x * 0.07f + 5.3f, z * 0.07f + 0.9f, 2) - 0.5f;
        float rock = fbm(x * 0.11f + wx * 3.f,
                         z * 0.11f + wz * 3.f, 4);
        // Raise only the top half so rocks are always rounded hills, not
        // symmetrical bumps: smoothstep from 0.45 → 1.0 maps to 0..1
        float t = std::max(0.f, (rock - 0.45f) / 0.55f);
        t = t * t * (3.f - 2.f * t);
        h += t * 5.5f * zoneFade;
    }

    // ---- Sand dunes (zl 8–60) ----
    // Two crossing FBM layers give natural dune ridges
    float duneBlend = std::max(0.f, std::min(1.f, (zl - 8.f) / 45.f));
    duneBlend = duneBlend * duneBlend;
    float duneA = fbm(x * 0.045f,        z * 0.045f,       4);
    float duneB = fbm(x * 0.038f + 4.f,  z * 0.038f + 7.f, 3);
    float dunes = (duneA * 0.65f + duneB * 0.35f);   // 0..1
    h += duneBlend * dunes * 6.5f;

    // ---- Hills inland (zl 50–180) ----
    float hillBlend = std::max(0.f, (zl - 50.f) / 90.f);
    hillBlend = hillBlend * hillBlend * (3.f - 2.f * hillBlend);
    // Domain-warp for non-radially-symmetric hills
    float hx = fbm(x * 0.018f + 2.3f, z * 0.018f + 5.7f, 2) - 0.5f;
    float hz = fbm(x * 0.018f + 8.1f, z * 0.018f + 1.2f, 2) - 0.5f;
    float hill = fbm(x * 0.022f + hx * 8.f,
                     z * 0.022f + hz * 8.f, 5);
    h += hillBlend * hill * 22.f;

    return std::max(0.f, h);
}

static Vec3 terrainNormal(float x, float z, float eps = 0.55f) {
    float hL = terrainH(x - eps, z);
    float hR = terrainH(x + eps, z);
    float hB = terrainH(x, z - eps);
    float hF = terrainH(x, z + eps);
    return Vec3{ hL - hR, 2.f * eps, hB - hF }.norm();
}

inline void buildTerrainMesh(Mesh& mesh,
                              int   Nx    = 200,
                              int   Nz    = 260,
                              float xHalf = 165.f,
                              float zMin  = -42.f,
                              float zMax  =  190.f)
{
    std::vector<Vertex>   verts;
    std::vector<unsigned> indices;
    verts.reserve((size_t)Nx * Nz);
    indices.reserve((size_t)(Nx-1) * (Nz-1) * 6);

    for (int iz = 0; iz < Nz; iz++) {
        float z = zMin + (zMax - zMin) * iz / (Nz - 1);
        for (int ix = 0; ix < Nx; ix++) {
            float x = -xHalf + 2.f * xHalf * ix / (Nx - 1);
            float h = terrainH(x, z);
            Vertex v;
            v.position = { x, h, z };
            v.normal   = terrainNormal(x, z);
            v.texcoord = { (float)ix / (Nx-1), (float)iz / (Nz-1) };
            verts.push_back(v);
        }
    }

    for (int iz = 0; iz < Nz - 1; iz++) {
        for (int ix = 0; ix < Nx - 1; ix++) {
            unsigned tl = iz * Nx + ix,
                     tr = iz * Nx + (ix+1),
                     bl = (iz+1) * Nx + ix,
                     br = (iz+1) * Nx + (ix+1);
            indices.push_back(tl); indices.push_back(bl); indices.push_back(tr);
            indices.push_back(tr); indices.push_back(bl); indices.push_back(br);
        }
    }

    mesh.build(verts, indices);
}
