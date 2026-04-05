#version 330 core

// Fullscreen triangle – no vertex buffer needed, uses gl_VertexID.
// Covers the entire screen with a single triangle (NDC coords).

out vec2 vNDC;

void main() {
    // Vertex 0: (-1,-1)  Vertex 1: (3,-1)  Vertex 2: (-1, 3)
    vec2 pos = vec2(
        (gl_VertexID == 1) ?  3.0 : -1.0,
        (gl_VertexID == 2) ?  3.0 : -1.0
    );
    vNDC        = pos;
    gl_Position = vec4(pos, 0.9999, 1.0);   // depth = 1 (far plane)
}
