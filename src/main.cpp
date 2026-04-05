#ifndef GL_GLEXT_PROTOTYPES
#define GL_GLEXT_PROTOTYPES
#endif
#include <GL/gl.h>
#include <GL/glext.h>
#include <GLFW/glfw3.h>

#include "vendor/imgui/imgui.h"
#include "vendor/imgui/imgui_impl_glfw.h"
#include "vendor/imgui/imgui_impl_opengl3.h"

#include "constants.hpp"
#include "math/linalg.hpp"
#include "renderer/shader.hpp"
#include "renderer/mesh.hpp"
#include "ocean/params.hpp"
#include "ocean/ocean_mesh.hpp"
#include "ocean/terrain_mesh.hpp"
#include "app/camera.hpp"
#include "app/ui.hpp"

#include <cstdio>
#include <cmath>
#include <string>

int main() {
    glfwSetErrorCallback([](int err, const char* desc) {
        std::fprintf(stderr, "GLFW Error %d: %s\n", err, desc);
    });
    if (!glfwInit()) return 1;

    const char* glsl_version = "#version 330";
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);

    GLFWwindow* window = glfwCreateWindow(
        SCREEN_WIDTH, SCREEN_HEIGHT, "Ocean Simulator", nullptr, nullptr);
    if (!window) { glfwTerminate(); return 1; }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);

    // Camera + GLFW callbacks
    Camera camera;
    glfwSetWindowUserPointer(window, &camera);
    glfwSetMouseButtonCallback(window, [](GLFWwindow* w, int btn, int action, int) {
        if (!ImGui::GetIO().WantCaptureMouse)
            ((Camera*)glfwGetWindowUserPointer(w))->onMouseButton(btn, action);
    });
    glfwSetCursorPosCallback(window, [](GLFWwindow* w, double x, double y) {
        ((Camera*)glfwGetWindowUserPointer(w))->onMouseMove(x, y);
    });
    glfwSetScrollCallback(window, [](GLFWwindow* w, double, double dy) {
        if (!ImGui::GetIO().WantCaptureMouse)
            ((Camera*)glfwGetWindowUserPointer(w))->onScroll(dy);
    });

    // ImGui
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGui::StyleColorsDark();
    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init(glsl_version);

    // Shaders
    Shader oceanShader, terrainShader, skyShader;

    auto shaderPath = [](const char* name) -> std::string {
        return std::string(SHADERS_PATH) + "/" + name;
    };

    auto loadShaders = [&]() -> bool {
        bool ok = true;
        ok &= oceanShader  .loadFromFiles(shaderPath("ocean.vert"  ).c_str(),
                                          shaderPath("ocean.frag"  ).c_str());
        ok &= terrainShader.loadFromFiles(shaderPath("terrain.vert").c_str(),
                                          shaderPath("terrain.frag").c_str());
        ok &= skyShader    .loadFromFiles(shaderPath("sky.vert"    ).c_str(),
                                          shaderPath("sky.frag"    ).c_str());
        return ok;
    };

    if (!loadShaders()) {
        std::fprintf(stderr, "Failed to load shaders from: %s\n", SHADERS_PATH);
        return 1;
    }

    // Meshes
    Mesh oceanMesh, terrainMesh;
    buildOceanMesh(oceanMesh);
    buildTerrainMesh(terrainMesh);

    // Empty VAO for the fullscreen sky triangle (uses gl_VertexID, no attributes)
    GLuint skyVAO;
    glGenVertexArrays(1, &skyVAO);

    // Ocean parameters
    OceanParams ocean = OceanParams::defaultParams();

    // GL state
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    double prevTime = glfwGetTime();
    float  simTime  = 0.f;

    while (!glfwWindowShouldClose(window)) {
        double now = glfwGetTime();
        float  dt  = (float)(now - prevTime);
        prevTime   = now;
        simTime   += dt;

        glfwPollEvents();
        if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS)
            glfwSetWindowShouldClose(window, GLFW_TRUE);

        // Resize
        int fbW, fbH;
        glfwGetFramebufferSize(window, &fbW, &fbH);
        glViewport(0, 0, fbW, fbH);
        if (fbH > 0) camera.aspect = (float)fbW / (float)fbH;

        camera.update();
        Mat4 view  = camera.viewMatrix();
        Mat4 proj  = camera.projMatrix();
        Mat4 model = identity4();
        Vec3 sunDir = ocean.sunDir();

        glClearColor(0.f, 0.f, 0.f, 1.f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        glPolygonMode(GL_FRONT_AND_BACK, ocean.wireframe ? GL_LINE : GL_FILL);

        // --- Sky (fullscreen triangle behind everything) ---
        glDepthMask(GL_FALSE);
        glDepthFunc(GL_LEQUAL);
        skyShader.use();
        skyShader.setVec3 ("uCamForward", camera.forward);
        skyShader.setVec3 ("uCamRight",   camera.right);
        skyShader.setVec3 ("uCamUp",      camera.up);
        skyShader.setFloat("uFovTan",     std::tan(camera.fovY * 0.5f));
        skyShader.setFloat("uAspect",     camera.aspect);
        skyShader.setVec3 ("uSunDir",     sunDir);
        skyShader.setVec3 ("uSunColor",   ocean.sunColor);
        glBindVertexArray(skyVAO);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDepthMask(GL_TRUE);
        glDepthFunc(GL_LESS);

        // --- Terrain ---
        terrainShader.use();
        terrainShader.setMat4("uModel",        model);
        terrainShader.setMat4("uView",         view);
        terrainShader.setMat4("uProj",         proj);
        terrainShader.setVec3("uSunDir",       sunDir);
        terrainShader.setVec3("uSunColor",     ocean.sunColor);
        terrainShader.setVec3 ("uCamPos",       camera.pos);
        terrainShader.setVec3 ("uShallowColor", ocean.shallowColor);
        terrainShader.setVec3 ("uDeepColor",    ocean.deepColor);
        terrainShader.setFloat("uTime",         simTime);
        terrainMesh.draw();

        // --- Ocean ---
        // Pack wave data into vec4 arrays
        float wave0[32], wave1[32];  // 8 × vec4
        for (int i = 0; i < 8; i++) {
            Vec2 d = ocean.waves[i].direction();
            wave0[i*4+0] = ocean.waves[i].amplitude;
            wave0[i*4+1] = ocean.waves[i].wavelength;
            wave0[i*4+2] = ocean.waves[i].steepness;
            wave0[i*4+3] = ocean.waves[i].speed;
            wave1[i*4+0] = d.x;
            wave1[i*4+1] = d.y;
            wave1[i*4+2] = 0.f;
            wave1[i*4+3] = 0.f;
        }
        oceanShader.use();
        oceanShader.setMat4 ("uModel",        model);
        oceanShader.setMat4 ("uView",         view);
        oceanShader.setMat4 ("uProj",         proj);
        oceanShader.setFloat("uTime",         simTime);
        oceanShader.setInt  ("uWaveCount",    ocean.waveCount);
        oceanShader.setVec4fv("uWave0",       8, wave0);
        oceanShader.setVec4fv("uWave1",       8, wave1);
        oceanShader.setVec3 ("uCamPos",       camera.pos);
        oceanShader.setVec3 ("uSunDir",       sunDir);
        oceanShader.setVec3 ("uSunColor",     ocean.sunColor);
        oceanShader.setVec3 ("uShallowColor", ocean.shallowColor);
        oceanShader.setVec3 ("uDeepColor",    ocean.deepColor);
        oceanShader.setFloat("uFoamThreshold",ocean.foamThreshold);
        oceanMesh.draw();

        // --- ImGui ---
        glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        drawUI(ocean, camera, loadShaders);

        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        glfwSwapBuffers(window);
    }

    // Cleanup
    oceanMesh.destroy();
    terrainMesh.destroy();
    glDeleteVertexArrays(1, &skyVAO);
    oceanShader.destroy();
    terrainShader.destroy();
    skyShader.destroy();

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
