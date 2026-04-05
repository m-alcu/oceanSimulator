#pragma once
#include <vector>
#include "renderer/mesh.hpp"

// Flat grid in the XZ plane (wave displacement applied in vertex shader).
// xHalf:  half-width in X
// zFar:   far edge (negative, toward open ocean)
// zNear:  near edge (slightly into beach, positive)
inline void buildOceanMesh(Mesh& mesh,
                            int   Nx    = 300,
                            int   Nz    = 300,
                            float xHalf = 200.f,
                            float zFar  = -300.f,
                            float zNear =  28.f)  // must reach past shorelineZ max (~+16)
{
    std::vector<Vertex>   verts;
    std::vector<unsigned> indices;
    verts.reserve((size_t)Nx * Nz);
    indices.reserve((size_t)(Nx-1) * (Nz-1) * 6);

    for (int iz = 0; iz < Nz; iz++) {
        float z = zFar + (zNear - zFar) * iz / (Nz - 1);
        for (int ix = 0; ix < Nx; ix++) {
            float x = -xHalf + 2.f * xHalf * ix / (Nx - 1);
            Vertex v;
            v.position = { x, 0.f, z };
            v.normal   = { 0.f, 1.f, 0.f };
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
