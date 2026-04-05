#pragma once
#include <functional>
#include "vendor/imgui/imgui.h"
#include "ocean/params.hpp"
#include "app/camera.hpp"

inline void drawUI(OceanParams& p, Camera& cam, std::function<bool()> reloadShaders) {
    ImGui::SetNextWindowPos({10, 10}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({310, 0}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.88f);

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove;
    if (!ImGui::Begin("Ocean Simulator", nullptr, flags)) { ImGui::End(); return; }

    ImGui::Text("FPS: %.1f  |  %.3f ms", ImGui::GetIO().Framerate,
                1000.f / ImGui::GetIO().Framerate);
    ImGui::Text("Cam: (%.1f, %.1f, %.1f)", cam.pos.x, cam.pos.y, cam.pos.z);
    ImGui::Separator();

    if (ImGui::CollapsingHeader("Sun", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderFloat("Elevation##sun", &p.sunElevation, 0.05f, 1.55f);
        ImGui::SliderFloat("Azimuth##sun",  &p.sunAzimuth,   0.f,  6.28f);
        ImGui::ColorEdit3("Sun Color",  (float*)&p.sunColor);
    }

    if (ImGui::CollapsingHeader("Waves", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderInt("Wave Count", &p.waveCount, 1, 8);
        for (int i = 0; i < p.waveCount; i++) {
            ImGui::PushID(i);
            char label[20]; snprintf(label, sizeof(label), "Wave %d", i + 1);
            if (ImGui::TreeNode(label)) {
                ImGui::SliderFloat("Amplitude",  &p.waves[i].amplitude,  0.01f, 6.f);
                ImGui::SliderFloat("Wavelength", &p.waves[i].wavelength, 2.f,  200.f);
                ImGui::SliderFloat("Steepness",  &p.waves[i].steepness,  0.f,   1.f);
                ImGui::SliderFloat("Direction",  &p.waves[i].dirAngle,  -3.14f, 3.14f);
                ImGui::SliderFloat("Speed",      &p.waves[i].speed,      0.1f,  5.f);
                ImGui::TreePop();
            }
            ImGui::PopID();
        }
    }

    if (ImGui::CollapsingHeader("Water", ImGuiTreeNodeFlags_DefaultOpen)) {
        ImGui::SliderFloat("Water Level",    &p.waterLevel,    -10.f, 20.f);
        ImGui::ColorEdit3("Shallow",         (float*)&p.shallowColor);
        ImGui::ColorEdit3("Deep",            (float*)&p.deepColor);
        ImGui::SliderFloat("Foam Threshold", &p.foamThreshold, 0.1f, 5.f);
    }

    if (ImGui::CollapsingHeader("Misc")) {
        ImGui::Checkbox("Wireframe", &p.wireframe);
        if (ImGui::Button("Reload Shaders")) {
            if (reloadShaders())
                ImGui::OpenPopup("OK##shaders");
            else
                ImGui::OpenPopup("Err##shaders");
        }
        if (ImGui::BeginPopup("OK##shaders"))  { ImGui::Text("Shaders reloaded."); ImGui::EndPopup(); }
        if (ImGui::BeginPopup("Err##shaders")) { ImGui::Text("Reload failed! Check console."); ImGui::EndPopup(); }
    }

    ImGui::End();
}
