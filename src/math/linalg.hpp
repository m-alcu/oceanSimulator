#pragma once
#include <cmath>

struct Vec2 { float x = 0, y = 0; };

struct Vec3 {
    float x = 0, y = 0, z = 0;
    Vec3() = default;
    Vec3(float x, float y, float z) : x(x), y(y), z(z) {}
    Vec3 operator+(Vec3 b) const { return {x+b.x, y+b.y, z+b.z}; }
    Vec3 operator-(Vec3 b) const { return {x-b.x, y-b.y, z-b.z}; }
    Vec3 operator*(float s) const { return {x*s, y*s, z*s}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3& operator+=(Vec3 b) { x+=b.x; y+=b.y; z+=b.z; return *this; }
    float dot(Vec3 b) const { return x*b.x + y*b.y + z*b.z; }
    Vec3 cross(Vec3 b) const { return {y*b.z-z*b.y, z*b.x-x*b.z, x*b.y-y*b.x}; }
    float len() const { return std::sqrt(x*x + y*y + z*z); }
    Vec3 norm() const { float l = len(); return l > 1e-6f ? *this*(1.f/l) : Vec3{0,1,0}; }
    const float* ptr() const { return &x; }
};

inline Vec3 operator*(float s, Vec3 v) { return v * s; }

// Column-major 4x4 matrix (OpenGL convention: m[col*4+row])
struct Mat4 {
    float m[16] = {};
    float& at(int r, int c) { return m[c*4+r]; }
    float  at(int r, int c) const { return m[c*4+r]; }
    const float* ptr() const { return m; }
};

inline Mat4 identity4() {
    Mat4 M;
    M.at(0,0) = M.at(1,1) = M.at(2,2) = M.at(3,3) = 1.f;
    return M;
}

inline Mat4 mul(const Mat4& A, const Mat4& B) {
    Mat4 C;
    for (int r = 0; r < 4; r++)
        for (int c = 0; c < 4; c++) {
            float s = 0;
            for (int k = 0; k < 4; k++) s += A.at(r,k) * B.at(k,c);
            C.at(r,c) = s;
        }
    return C;
}

inline Mat4 perspective(float fovY, float aspect, float zNear, float zFar) {
    float t = 1.f / std::tan(fovY * 0.5f);
    Mat4 M;
    M.at(0,0) = t / aspect;
    M.at(1,1) = t;
    M.at(2,2) = -(zFar + zNear) / (zFar - zNear);
    M.at(2,3) = -2.f * zFar * zNear / (zFar - zNear);
    M.at(3,2) = -1.f;
    return M;
}

inline Mat4 lookAt(Vec3 eye, Vec3 center, Vec3 up) {
    Vec3 f = (center - eye).norm();
    Vec3 r = f.cross(up).norm();
    Vec3 u = r.cross(f);
    Mat4 M;
    M.at(0,0)= r.x; M.at(0,1)= r.y; M.at(0,2)= r.z; M.at(0,3)=-r.dot(eye);
    M.at(1,0)= u.x; M.at(1,1)= u.y; M.at(1,2)= u.z; M.at(1,3)=-u.dot(eye);
    M.at(2,0)=-f.x; M.at(2,1)=-f.y; M.at(2,2)=-f.z; M.at(2,3)= f.dot(eye);
    M.at(3,3) = 1.f;
    return M;
}
