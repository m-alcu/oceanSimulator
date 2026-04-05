#pragma once

#ifndef GL_GLEXT_PROTOTYPES
#define GL_GLEXT_PROTOTYPES
#endif
#include <GL/gl.h>
#include <GL/glext.h>

#include <fstream>
#include <sstream>
#include <string>
#include <cstdio>
#include "math/linalg.hpp"

class Shader {
    GLuint prog = 0;

    static GLuint compileStage(GLenum type, const char* src) {
        GLuint s = glCreateShader(type);
        glShaderSource(s, 1, &src, nullptr);
        glCompileShader(s);
        int ok; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            char log[1024]; glGetShaderInfoLog(s, sizeof(log), nullptr, log);
            std::fprintf(stderr, "Shader compile error:\n%s\n", log);
            glDeleteShader(s); return 0;
        }
        return s;
    }

public:
    bool loadFromFiles(const char* vertPath, const char* fragPath) {
        auto readFile = [](const char* path) -> std::string {
            std::ifstream f(path);
            if (!f) { std::fprintf(stderr, "Cannot open: %s\n", path); return ""; }
            std::ostringstream ss; ss << f.rdbuf(); return ss.str();
        };
        std::string vs = readFile(vertPath);
        std::string fs = readFile(fragPath);
        if (vs.empty() || fs.empty()) return false;
        return build(vs.c_str(), fs.c_str());
    }

    bool build(const char* vs, const char* fs) {
        GLuint v = compileStage(GL_VERTEX_SHADER,   vs);
        GLuint f = compileStage(GL_FRAGMENT_SHADER, fs);
        if (!v || !f) { glDeleteShader(v); glDeleteShader(f); return false; }

        if (prog) glDeleteProgram(prog);
        prog = glCreateProgram();
        glAttachShader(prog, v);
        glAttachShader(prog, f);
        glLinkProgram(prog);
        glDeleteShader(v); glDeleteShader(f);

        int ok; glGetProgramiv(prog, GL_LINK_STATUS, &ok);
        if (!ok) {
            char log[1024]; glGetProgramInfoLog(prog, sizeof(log), nullptr, log);
            std::fprintf(stderr, "Program link error:\n%s\n", log);
            glDeleteProgram(prog); prog = 0;
        }
        return ok != 0;
    }

    void use() { glUseProgram(prog); }
    GLuint id() const { return prog; }
    bool valid() const { return prog != 0; }

    void setInt  (const char* n, int v)   { glUniform1i(loc(n), v); }
    void setFloat(const char* n, float v) { glUniform1f(loc(n), v); }
    void setVec3 (const char* n, Vec3 v)  { glUniform3f(loc(n), v.x, v.y, v.z); }
    void setVec3 (const char* n, float x, float y, float z) { glUniform3f(loc(n), x, y, z); }
    void setMat4 (const char* n, const Mat4& m) {
        glUniformMatrix4fv(loc(n), 1, GL_FALSE, m.ptr());
    }
    void setVec4fv(const char* n, int count, const float* data) {
        glUniform4fv(loc(n), count, data);
    }

    void destroy() { if (prog) { glDeleteProgram(prog); prog = 0; } }

private:
    GLint loc(const char* n) const { return glGetUniformLocation(prog, n); }
};
