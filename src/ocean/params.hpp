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

    Vec3  shallowColor   = {0.02f, 0.20f, 0.26f};   // muted teal, nearly clear
    Vec3  deepColor      = {0.01f, 0.06f, 0.20f};   // dark blue, seen only in deep
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
        // Spread directions evenly across ~270° and use incommensurable
        // wavelengths (no common divisor) to push the tiling period far out.
        // Primary swell N
        p.waves[0] = { 1.40f,  67.f, 0.20f,  0.00f, 1.00f };
        // Swell NE (~50°)
        p.waves[1] = { 0.80f,  53.f, 0.18f,  0.87f, 0.94f };
        // Cross-swell NW (~−55°)
        p.waves[2] = { 0.65f,  41.f, 0.17f, -0.96f, 0.88f };
        // Wind chop NNE (~25°), shorter
        p.waves[3] = { 0.38f,  17.f, 0.40f,  0.44f, 1.60f };
        // Wind chop WNW (~−70°)
        p.waves[4] = { 0.30f,  13.f, 0.38f, -1.22f, 1.70f };
        // Short chop ENE (~65°)
        p.waves[5] = { 0.22f,   8.3f, 0.35f,  1.13f, 1.90f };
        // Fine ripple at odd angle (~−30°)
        p.waves[6] = { 0.13f,   5.1f, 0.28f, -0.52f, 2.30f };
        // Fine ripple (~110°)
        p.waves[7] = { 0.09f,   3.7f, 0.25f,  1.92f, 2.55f };
        return p;
    }
};
