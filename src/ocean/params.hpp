#pragma once
#include <cmath>
#include "math/linalg.hpp"

struct GerstnerWave {
    float amplitude  = 1.0f;  // A  — height of crest above still water
    float wavelength = 60.0f; // λ  — distance between crests
    float steepness  = 0.3f;  // Q  — 0=sine, 1=sharp Gerstner crest
    float dirAngle   = 0.0f;  // radians — horizontal direction of travel
    float speed      = 1.0f;  // multiplier on deep-water phase speed

    Vec2 direction() const {
        return { std::cos(dirAngle), std::sin(dirAngle) };
    }
};

struct OceanParams {
    int          waveCount     = 6;
    GerstnerWave waves[8];

    Vec3  shallowColor   = {0.04f, 0.46f, 0.62f};
    Vec3  deepColor      = {0.01f, 0.12f, 0.38f};
    float foamThreshold  = 1.1f;
    float waterLevel     = 0.0f;  // world-space Y of the sea surface

    float sunElevation   = 0.55f;  // radians from horizon
    float sunAzimuth     = 0.8f;   // radians
    Vec3  sunColor       = {1.00f, 0.95f, 0.82f};

    bool  wireframe      = false;

    Vec3 sunDir() const {
        float ce = std::cos(sunElevation), se = std::sin(sunElevation);
        float ca = std::cos(sunAzimuth),   sa = std::sin(sunAzimuth);
        return Vec3{ce * sa, se, ce * ca}.norm();
    }

    static OceanParams defaultParams() {
        OceanParams p;
        p.waveCount = 8;
        // Primary swell from NW  (0°)
        p.waves[0] = { 1.40f, 64.f, 0.22f,  0.00f, 1.00f };
        // Secondary swell from NE (~75°) — opposes primary slightly
        p.waves[1] = { 0.75f, 46.f, 0.20f,  1.30f, 0.92f };
        // Storm swell from SW (~200°) — head-on cross
        p.waves[2] = { 0.60f, 38.f, 0.18f,  3.49f, 0.85f };
        // Wind chop NNE (~30°)
        p.waves[3] = { 0.35f, 14.f, 0.42f,  0.52f, 1.55f };
        // Wind chop from W (~270°)
        p.waves[4] = { 0.28f, 11.f, 0.40f,  4.71f, 1.65f };
        // Short chop SE (~135°)
        p.waves[5] = { 0.20f,  7.f, 0.38f,  2.36f, 1.85f };
        // Fine ripple NW-ish
        p.waves[6] = { 0.12f,  4.f, 0.30f, -0.42f, 2.20f };
        // Fine ripple S (~180°)
        p.waves[7] = { 0.09f,  3.f, 0.28f,  3.14f, 2.40f };
        return p;
    }
};
