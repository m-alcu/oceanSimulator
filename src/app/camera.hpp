#pragma once
#include <cmath>
#include <GLFW/glfw3.h>
#include "math/linalg.hpp"

struct Camera {
    // Orbit parameters
    Vec3  target    = { 0.f, 2.f, 0.f };
    float azimuth   = 0.0f;    // horizontal angle (radians)
    float elevation = 0.28f;   // vertical angle above horizon (radians)
    float radius    = 70.f;    // distance from target

    float fovY   = 0.80f;      // ~46 degrees
    float aspect = 16.f / 9.f;

    // Derived (updated by update())
    Vec3 pos, forward, right, up;

    void update() {
        float cosEl = std::cos(elevation);
        float sinEl = std::sin(elevation);
        pos = target + Vec3{
            radius * cosEl * std::sin(azimuth),
            radius * sinEl,
            radius * cosEl * std::cos(azimuth)
        };
        forward = (target - pos).norm();
        right   = forward.cross(Vec3{0,1,0}).norm();
        up      = right.cross(forward);
    }

    Mat4 viewMatrix() const { return lookAt(pos, target, {0,1,0}); }
    Mat4 projMatrix() const { return perspective(fovY, aspect, 0.5f, 800.f); }

    // ---- GLFW input ----
    bool   dragging = false;
    double lastX = 0, lastY = 0;

    void onMouseButton(int button, int action) {
        if (button == GLFW_MOUSE_BUTTON_LEFT)
            dragging = (action == GLFW_PRESS);
    }

    void onMouseMove(double xpos, double ypos) {
        if (dragging) {
            azimuth   -= (float)(xpos - lastX) * 0.005f;
            elevation += (float)(ypos - lastY) * 0.005f;
            elevation  = std::max(-0.05f, std::min(1.55f, elevation));
        }
        lastX = xpos; lastY = ypos;
    }

    void onScroll(double dy) {
        radius *= std::exp((float)(-dy * 0.1));
        radius  = std::max(5.f, std::min(600.f, radius));
    }
};
