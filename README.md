# PBR Path Tracer

A physically-based CPU path tracer written in C++17, rendered progressively into an SDL3 streaming texture with a Dear ImGui overlay.

Ray Tracing (broad technique)\
└── Path Tracing (specific Monte Carlo algorithm)\
└── PBR Path Tracing (path tracing + physically valid BRDFs)

---

## Features

- **Unbiased Monte Carlo path tracing** with cosine-weighted importance sampling
- **Lambertian (diffuse) BRDF** with correct throughput accounting
- **GGX microfacet BRDF** (Cook-Torrance) with Smith masking, Schlick Fresnel, Disney roughness remapping
- **Dielectric (glass) material** — Fresnel reflectance, Snell's law refraction, total internal reflection
- **Metallic (specular) BRDF** with configurable roughness fuzz; probabilistic lobe mixing
- **Next Event Estimation (NEE)** — explicit direct light sampling at every bounce, dramatically reducing noise from small area lights
- **Multiple Importance Sampling (MIS)** — power heuristic combines NEE and BSDF sampling to eliminate bias while preserving variance reduction
- **Russian roulette** path termination
- **Binary BVH** (bounding volume hierarchy) over triangle meshes for fast ray–mesh intersection
- **Analytical sphere** intersection in the same scene
- **Reinhard tone mapping** + gamma-2 correction
- **Progressive accumulation**: each frame adds one sample per pixel; the image refines indefinitely
- **Multi-threaded rendering**: one `std::thread` per CPU core, row-striped (no contention)
- **Four sampler strategies** selectable at runtime: PCG32 (independent), Hash (reproducible), Halton (QMC, Cranley-Patterson), **Sobol** (QMC, XOR-scrambled, default)
- **YAML scene files**: define camera, materials (`albedo`, `emission`, `metallic`, `roughness`, `ior`, `transmission`), OBJ meshes and spheres
- **Interactive orbit camera**: left-drag to orbit, scroll to zoom — resets accumulation on change
- **Dear ImGui panel**: live SPP counter, FPS, thread count, scene switcher, BRDF mode selector, sampler selector

---

## Theory

### 1. The Rendering Equation

The foundation of the renderer is Kajiya's rendering equation (1986):

```math
L_o(\mathbf{x},\,\omega_o) = L_e(\mathbf{x},\,\omega_o) + \int_{\Omega} f_r(\mathbf{x},\,\omega_i,\,\omega_o)\,L_i(\mathbf{x},\,\omega_i)\,(\omega_i \cdot \mathbf{n})\,d\omega_i
```
<p align="center">
  <img src="resources/Rendering_eq.png" width="300">
</p>

The equation describes the amount of light leaving a point x along a particular viewing direction, given functions for incoming light and emitted light, and a BRDF.
ref: https://en.wikipedia.org/wiki/Rendering_equation

| Symbol | Meaning |
|--------|---------|
| `Lo(x, ωo)` | Outgoing radiance at surface point `x` in direction `ωo` |
| `Le(x, ωo)` | Emitted radiance (non-zero only for light sources) |
| `fr(x, ωi, ωo)` | Bidirectional Reflectance Distribution Function (BRDF) |
| `Li(x, ωi)` | Incoming radiance from direction `ωi` |
| `ωi · n` | Cosine of the angle between incident direction and surface normal |
| `Ω` | Hemisphere above the surface point |

`fr(x, ωi, ωo)` could be of several types:

| `fr(x, ωi, ωo)` | BSDF |
|--------|---------|
| diffuse | <img src="resources/diffuse.png" width="200"> |
| glossy | <img src="resources/glossy.png" width="200"> |
| specular | <img src="resources/specular.png" width="200"> |
| retro-reflective | <img src="resources/retro-reflective.png" width="200"> |



The integral has no closed form for general scenes, so we solve it with Monte Carlo estimation.

---

### 2. Monte Carlo Estimation

A Monte Carlo estimator for an integral `∫ f(x) dx` is:

```math
\hat{I} \approx \frac{1}{N} \sum_{i=1}^{N} \frac{f(x_i)}{p(x_i)}
```

where $x_i$ are samples drawn from probability density $p$. Applied to the rendering equation:

```math
L_o \approx L_e + \frac{1}{N} \sum_{i=1}^{N} \frac{f_r(\omega_i)\,L_i(\omega_i)\,(\omega_i \cdot \mathbf{n})}{p(\omega_i)}
```

Each sample traces one random path through the scene. After `N` samples the estimator converges to the true solution; variance decreases as `1/√N`.

---

### 3. Lambertian BRDF

The Lambertian (perfectly diffuse) BRDF is:

```math
f_r(\mathbf{x},\,\omega_i,\,\omega_o) = \frac{\rho}{\pi}
```

It is constant — scattering is equal in all directions — and $\rho \in [0,1]^3$ (3D) is the albedo (fraction of light reflected per colour channel). The factor $1/\pi$ normalises energy conservation:

```math
\int_{\Omega} f_r\,(\omega_i \cdot \mathbf{n})\,d\omega_i = \int_{\Omega} \frac{\rho}{\pi}\cos\theta\,d\omega_i = \rho
```

---

### 4. Metallic (Specular) BRDF

For metallic conductors, light does not penetrate the material — it reflects off the surface, tinted by the metal's characteristic color. Two parameters control the behaviour:

| Parameter | Range | Meaning |
|-----------|-------|---------|
| `metallic` | [0, 1] | Probability of choosing the specular lobe over the diffuse lobe at each bounce |
| `roughness` | [0, 1] | Amount of micro-surface perturbation applied to the ideal reflected direction |

<p align="left">
  <img src="resources/metals.png" width="800">
</p>

#### Perfect mirror reflection

A perfect specular reflector maps an incoming direction $\omega_o$ to a unique outgoing direction by reflecting about the surface normal $\mathbf{n}$:

```math
\omega_r = \omega_o - 2\,(\omega_o \cdot \mathbf{n})\,\mathbf{n}
```

The BRDF of a perfect mirror is a delta distribution:

```math
f_r^{\text{spec}}(\omega_i,\omega_o) = \frac{\rho \;\delta(\omega_i - \omega_r)}{\cos\theta_i}
```

When evaluated inside the path tracer the delta collapses with the sampling PDF, leaving the same throughput update as the Lambertian case:

```math
\beta \;\leftarrow\; \beta \otimes \rho
```

#### Roughness fuzz

Real metals are not perfect mirrors; microscopic surface irregularities spread the reflected cone. A uniform random point $\mathbf{s}$ is sampled inside the unit ball and added to the ideal reflected direction, scaled by `roughness`:

```math
\omega_i = \mathrm{normalize}\!\left(\omega_r + \texttt{roughness}\cdot\mathbf{s}\right), \qquad \mathbf{s} \sim \mathrm{Uniform}(\mathbb{B}^3)
```

`roughness = 0` recovers the perfect mirror; `roughness = 1` produces a heavily blurred reflection. If the perturbation pushes $\omega_i$ below the surface ($\omega_i \cdot \mathbf{n} \le 0$), the ray is absorbed (the path terminates).

The unit ball sample is obtained by rejection — draw $\mathbf{p} \sim \mathrm{Uniform}([-1,1]^3)$ and retry until $|\mathbf{p}|^2 < 1$.

#### Probabilistic lobe mixing

At each bounce the path tracer selects a lobe stochastically:

```
with probability  metallic  → specular bounce,  β ⊗= albedo
with probability  1−metallic → diffuse bounce,  β ⊗= albedo
```

Both branches produce the **same throughput factor** (`albedo`), so the selection probability cancels algebraically and no explicit $1/p$ correction is needed — the estimator is unbiased for any value of `metallic`.

---

### 5. Cosine-Weighted Hemisphere Sampling

Naïve uniform hemisphere sampling has high variance because the `cos(θ)` term in the integrand approaches zero near the horizon. **Cosine-weighted** sampling draws `ωi` proportional to `cos(θ)`, exactly matching that factor:

```math
p(\omega_i) = \frac{\cos\theta}{\pi}
```

Substituting into the Monte Carlo estimator for a Lambertian surface:

```math
\frac{f_r\,(\omega_i \cdot \mathbf{n})}{p(\omega_i)} = \frac{(\rho/\pi)\cos\theta}{\cos\theta/\pi} = \rho
```

The $\cos\theta$ and $\pi$ factors cancel exactly, so the **throughput update per bounce is simply**:

```math
\beta \leftarrow \beta \otimes \rho \qquad (\otimes = \text{component-wise multiply})
```

This is what `tracePath()` does — no extra cosine evaluation needed.

#### Sampling formula (Malley's method)

Given two uniform random numbers $u_1, u_2 \in [0,1)$:

```math
r = \sqrt{u_1}, \qquad \varphi = 2\pi u_2
```

```math
x = r\cos\varphi, \quad y = r\sin\varphi, \quad z = \sqrt{1 - u_1}
```

where $z$ is the "up" axis, aligned with the surface normal.

This samples the unit disk uniformly and projects it up onto the hemisphere, producing the cosine-weighted distribution. Implemented in `sampleCosineHemisphere()`.

---

### 6. Orthonormal Basis (ONB) Construction

The sampled direction `(x, y, z)` is in a local frame where `z = n̂`. To transform it to world space we build a tangent frame `(T, B, N)` using:

```
up = (|n.z| < 0.999) ? (0,0,1) : (0,1,0)    ← avoid parallel case
T  = normalize(up × n)
B  = n × T
```

Then the world-space bounce direction is:

```math
\omega_i = \mathrm{normalize}(T\,x + B\,y + \mathbf{n}\,z)
```

Implemented in `makeONB()`.

---

### 7. Path Throughput and Recursive Estimator

The path tracer unrolls the recursive rendering equation into a loop. It maintains a **throughput** vector `β` that accumulates the product of BRDFs and sampling weights along the path:

```math
\beta_0 = (1,1,1), \qquad \beta_{k+1} = \beta_k \otimes \rho
```

At each bounce, the emitted radiance is accumulated:

```math
L \mathrel{+}= \beta \cdot L_e
```

When the path escapes the scene (no intersection), the sky radiance is added:

```math
L \mathrel{+}= \beta \cdot L_{\mathrm{sky}}(\omega_i)
```

where the sky is a simple gradient:

```math
L_{\mathrm{sky}}(\mathbf{d}) = (1-t)\,(1,1,1) + t\,(0.5,\,0.7,\,1.0), \qquad t = \tfrac{1}{2}(d_y + 1)
```

---

### 8. Russian Roulette Path Termination

Paths that contribute little energy waste computation. **Russian roulette** terminates a path with probability `(1 − p)` and, if it survives, boosts the throughput to keep the estimator unbiased:

```math
p = \mathrm{clamp}\!\left(\max(\beta_r,\,\beta_g,\,\beta_b),\;0.05,\;0.95\right)
```

```
if rand() > p: terminate path
```

```math
\beta \leftarrow \frac{\beta}{p}
```

Applied from `depth ≥ 3`, this eliminates low-contribution paths while maintaining an unbiased estimate (the expected value of `β/p` equals `β`).

---

### 9. GGX Microfacet BRDF (Cook-Torrance)

Real surfaces are not perfectly smooth — they consist of many tiny mirror-like **microfacets**. Microfacet theory models the aggregate appearance via a statistical distribution of surface normals.

The Cook-Torrance specular BRDF is:

```math
f_r^{\text{spec}}(\omega_i,\omega_o) = \frac{D(\mathbf{h})\,F(\omega_o,\mathbf{h})\,G(\omega_i,\omega_o)}{4\,(\mathbf{n}\cdot\omega_i)\,(\mathbf{n}\cdot\omega_o)}
```

where $\mathbf{h} = \mathrm{normalize}(\omega_i + \omega_o)$ is the **half-vector** (the microfacet normal that would reflect $\omega_i$ toward $\omega_o$).

| Term | Name | Role |
|------|------|------|
| $D(\mathbf{h})$ | Normal Distribution Function (NDF) | Fraction of microfacets facing direction $\mathbf{h}$ |
| $F(\omega_o, \mathbf{h})$ | Fresnel term | Fraction of light reflected vs. refracted |
| $G(\omega_i, \omega_o)$ | Masking-shadowing function | Fraction of microfacets that are visible to both the light and the viewer |

#### Normal Distribution Function — GGX (Trowbridge-Reitz)

The GGX NDF gives a longer specular tail than Blinn-Phong, matching real materials better:

```math
D(\mathbf{h}) = \frac{\alpha^2}{\pi \left[ (\mathbf{n}\cdot\mathbf{h})^2(\alpha^2-1)+1 \right]^2}
```

where $\alpha$ is the **GGX roughness** parameter. Disney perceptual remapping squares the artist-facing `roughness` parameter so that equal steps feel visually equal:

```math
\alpha = \texttt{roughness}^2
```

#### Schlick Fresnel Approximation

The Fresnel equations give the fraction of light reflected at an interface. Schlick's approximation is efficient and accurate:

```math
F(\omega_o,\mathbf{h}) = F_0 + (1-F_0)(1 - \omega_o\cdot\mathbf{h})^5
```

$F_0$ is the **normal-incidence reflectance** — the colour of the surface when viewed straight on:

```math
F_0 = \begin{cases} 0.04 & \text{dielectric} \\ \text{albedo} & \text{metallic} \end{cases}
```

For a conductor/dielectric blend (metallic workflow):
```math
F_0 = 0.04 + (\text{albedo} - 0.04)\times\texttt{metallic}
```

#### Smith Masking-Shadowing (G2)

Microfacets near the horizon can be shadowed from the light or masked from the viewer. Smith's uncorrelated G2:

```math
G(\omega_i,\omega_o) = G_1(\omega_i)\,G_1(\omega_o)
```

```math
G_1(\omega) = \frac{2\,(\mathbf{n}\cdot\omega)}{\mathbf{n}\cdot\omega + \sqrt{\alpha^2 + (1-\alpha^2)(\mathbf{n}\cdot\omega)^2}}
```

#### GGX Importance Sampling

To reduce variance, the microfacet normal $\mathbf{h}$ is importance-sampled from the NDF. Inverting the GGX CDF gives the polar angle:

```math
\cos^2\theta = \frac{1 - u_1}{1 + (\alpha^2-1)\,u_1}, \qquad \phi = 2\pi u_2
```

The corresponding $\omega_i$ is obtained by reflecting $\omega_o$ about $\mathbf{h}$. The PDF of the sampled direction $\omega_i$ in solid angle measure is:

```math
p_{\text{GGX}}(\omega_i) = \frac{D(\mathbf{h})\,(\mathbf{n}\cdot\mathbf{h})}{4\,(\omega_o\cdot\mathbf{h})}
```

When this PDF is divided into the BRDF × cos, the throughput weight per specular bounce is:

```math
\beta \;\leftarrow\; \beta \otimes F \cdot \frac{G\,(\omega_o\cdot\mathbf{h})}{(\mathbf{n}\cdot\omega_o)\,(\mathbf{n}\cdot\mathbf{h})}
```

#### Probabilistic Lobe Mixing (Diffuse + Specular)

At each bounce the path randomly selects the specular lobe with probability $p_s$ based on the average Fresnel at the current viewing angle:

```math
p_s = \mathrm{clamp}\!\left(\frac{F_x + F_y + F_z}{3},\;0.05,\;0.95\right)
```

The final throughput is divided by $p_s$ (specular) or $(1-p_s)$ (diffuse) to keep the mixed estimator unbiased.

---

### 10. Dielectric (Glass) Material

<p align="left">
  <img src="resources/glass.png" glass="600">
</p>

A dielectric (glass, water) transmits light through the surface. At each interface, light splits between **reflection** and **refraction** according to the Fresnel equations.

#### Snell's Law (Vector Form)

Given incident direction $\mathbf{d}$ (pointing toward the surface), face normal $\hat{\mathbf{n}}$ (pointing toward the incident medium), and relative IOR $\eta = n_1/n_2$:

```math
\mathbf{t} = \eta\,\mathbf{d} + \left(\eta\cos\theta_i - \cos\theta_t\right)\hat{\mathbf{n}}
```

where $\cos\theta_i = -\mathbf{d}\cdot\hat{\mathbf{n}}$ and $\cos\theta_t = \sqrt{1 - \eta^2(1-\cos^2\theta_i)}$.

If $\eta^2(1-\cos^2\theta_i) > 1$ there is **Total Internal Reflection (TIR)** — no refracted ray exists and all light reflects back.

#### Fresnel Reflectance (Schlick for Dielectrics)

```math
R_0 = \left(\frac{n_1 - n_2}{n_1 + n_2}\right)^2
```

```math
R(\theta) = R_0 + (1-R_0)(1-\cos\theta_i)^5
```

$R(\theta)$ is the probability of reflection; $1 - R(\theta)$ is the probability of transmission.

#### Stochastic BSDF

Since the reflectance is a probability, the path tracer applies it stochastically: with probability $R$ reflect the ray, with probability $1-R$ refract it. Beta is unchanged (glass carries energy without absorption):

```math
\beta \leftarrow \beta \otimes (1,1,1) = \beta
```

Glass paths skip Russian roulette to avoid terminating paths whose throughput should remain at 1.

---

### 11. The Problem with Naive Path Tracing

In a scene with a small area light, the probability that a randomly chosen BSDF sample points directly at the light is tiny:

```math
P(\text{hit light}) = \frac{\Omega_{\text{light}}}{2\pi} \;\ll\; 1
```

where $\Omega_{\text{light}}$ is the solid angle subtended by the light. The estimator is unbiased but has enormous variance — the image looks noisy even after thousands of samples. For a sphere light of radius $r$ at distance $d$:

```math
\Omega_{\text{light}} = 2\pi\left(1 - \sqrt{1 - \frac{r^2}{d^2}}\right)
```

A Cornell-box ceiling light ($r=0.1$, $d\approx1.8$) subtends roughly $0.1\,\text{sr}$ out of the $2\pi\approx6.28\,\text{sr}$ upper hemisphere — only about 1.6% of random diffuse samples hit it.

---

### 12. Next Event Estimation (NEE)

NEE eliminates this inefficiency by **explicitly sampling area lights** at every diffuse bounce instead of hoping a random direction hits one.

At each non-specular hit point $\mathbf{x}$ with outgoing direction $\omega_o$:

1. Choose a light $\ell$ uniformly at random from $N_L$ sphere lights.
2. Sample a direction $\omega_\ell$ toward light $\ell$ with PDF $p_\ell(\omega_\ell)$ in solid angle measure.
3. Cast a **shadow ray** from $\mathbf{x}$ toward $\omega_\ell$. If the light is visible, add:

```math
L_{\text{NEE}} = \beta \cdot \frac{f_r(\omega_o, \omega_\ell)\,(\omega_\ell\cdot\mathbf{n})\,L_e^{(\ell)}}{p_\text{select}\,p_\ell(\omega_\ell)}
```

where $p_{\rm sel} = 1/N_L$ is the uniform light-selection probability and $L_e^{(\ell)}$ is the emitted radiance of the chosen light.

#### Sphere Light — Cone Sampling

A sphere of centre $\mathbf{c}$ and radius $r$ subtends a cone of half-angle $\theta_{\max}$ from point $\mathbf{x}$:

```math
\sin\theta_{\max} = \frac{r}{\|\mathbf{c} - \mathbf{x}\|}
\qquad\Longrightarrow\qquad
\cos\theta_{\max} = \sqrt{1 - \frac{r^2}{\|\mathbf{c}-\mathbf{x}\|^2}}
```

Sampling uniformly within this cone (i.e., sampling a solid angle of $2\pi(1-\cos\theta_{\max})$):

```math
\cos\theta = 1 - u_1\,(1-\cos\theta_{\max}), \qquad \phi = 2\pi u_2
```

The resulting PDF (uniform over the cone solid angle) is:

```math
p_\ell(\omega) = \frac{1}{2\pi(1 - \cos\theta_{\max})}
```

A local frame is built with $\hat{z}$ pointing from $\mathbf{x}$ toward $\mathbf{c}$, and the sampled direction is:

```math
\omega_\ell = \sin\theta\cos\phi\;\hat{T} + \sin\theta\sin\phi\;\hat{B} + \cos\theta\;\hat{z}
```

#### Shadow Ray Visibility Test

The shadow ray origin is offset by $\varepsilon\hat{\mathbf{n}}$ to avoid self-intersection. The ray is visible to the light if:
- it hits nothing at all, or
- the first object it hits is the sampled sphere light itself.

This is tested by comparing `Hit::sphereIdx` of the shadow ray's closest intersection against the index of the chosen light sphere.

---

### 13. Multiple Importance Sampling (MIS)

NEE introduces a problem: **double-counting**. Both the NEE estimator and the ordinary BSDF path sampling can account for the same path from $\mathbf{x}$ to the light. Naively adding both would overestimate the illumination.

#### The Two-Sample Estimator

Consider two estimators for the same quantity $I = \int f(x)\,dx$:
- Estimator 1 uses sampling strategy with PDF $p_1$ — good at some regions.
- Estimator 2 uses sampling strategy with PDF $p_2$ — good at others.

A naive average $\frac{1}{2}(f(x_1)/p_1(x_1) + f(x_2)/p_2(x_2))$ has high variance near the boundaries of each strategy's effective region.

MIS assigns a **weight** $w_s(x)$ to each estimator so that $\sum_s w_s(x) = 1$, giving the combined estimator:

```math
\hat{I}_{\text{MIS}} = \sum_{s} \frac{1}{n_s} \sum_{j=1}^{n_s} w_s(x_{s,j})\,\frac{f(x_{s,j})}{p_s(x_{s,j})}
```

This is **unbiased** as long as $\sum_s w_s(x) = 1$ whenever $f(x) \neq 0$.

#### Balance Heuristic

The simplest valid choice (Veach 1995):

```math
w_s(x) = \frac{n_s\,p_s(x)}{\sum_t n_t\,p_t(x)}
```

With one sample per strategy ($n_s = n_t = 1$):

```math
w_{\text{NEE}}(\omega) = \frac{p_\text{NEE}(\omega)}{p_\text{NEE}(\omega) + p_\text{BSDF}(\omega)}, \qquad
w_{\text{BSDF}}(\omega) = \frac{p_\text{BSDF}(\omega)}{p_\text{NEE}(\omega) + p_\text{BSDF}(\omega)}
```

Note $w_\text{NEE} + w_\text{BSDF} = 1$ — the condition is satisfied.

#### Power Heuristic (β = 2)

The balance heuristic can still have high variance when one PDF is much larger than the other. Raising the PDFs to a power $\beta$ before normalising suppresses contributions from strategies with poor PDFs more aggressively:

```math
w_s(x) = \frac{\left[n_s\,p_s(x)\right]^\beta}{\sum_t \left[n_t\,p_t(x)\right]^\beta}
```

With $\beta = 2$ and one sample each (used in this renderer):

```math
w_{\text{NEE}}(\omega) = \frac{p_\text{NEE}^2}{p_\text{NEE}^2 + p_\text{BSDF}^2}, \qquad
w_{\text{BSDF}}(\omega) = \frac{p_\text{BSDF}^2}{p_\text{NEE}^2 + p_\text{BSDF}^2}
```

When one PDF dominates (e.g., $p_\text{NEE} \gg p_\text{BSDF}$), the weight approaches 1 for NEE and 0 for BSDF — concentrating variance where each estimator is effective. Veach showed $\beta = 2$ is near-optimal in practice.

#### Full NEE + MIS Path Contribution

For a path that bounces diffusely at $\mathbf{x}$ and then continues to the next hit:

**Direct light contribution (NEE sample at $\mathbf{x}$):**
```math
\Delta L_{\text{direct}} = \beta \cdot w_{\text{NEE}}(\omega_\ell) \cdot \frac{f_r(\omega_o,\omega_\ell)\,(\omega_\ell\cdot\mathbf{n})\,L_e}{p_\text{NEE}(\omega_\ell)}
```

**Emissive surface hit via BSDF sample (at next bounce):**
```math
\Delta L_{\text{emissive}} = \beta \cdot w_{\text{BSDF}}(\omega_i) \cdot L_e
```

where $w_{\text{BSDF}}(\omega_i)$ uses $p_\text{BSDF}(\omega_i)$ computed at the bounce that generated $\omega_i$ and $p_\text{NEE}(\omega_i) = p_\ell(\omega_i) / N_L$ for the hypothetical NEE sample in the same direction.

#### BSDF PDF for the GGX + Lambertian Mixture

The mixture sampling strategy selects specular with probability $p_s$ and diffuse with probability $1-p_s$. The combined PDF of direction $\omega_i$ is:

```math
p_\text{BSDF}(\omega_i) = p_s \cdot p_\text{GGX}(\omega_i) + (1-p_s) \cdot p_\text{Lambert}(\omega_i)
```

```math
p_\text{GGX}(\omega_i) = \frac{D(\mathbf{h})\,(\mathbf{n}\cdot\mathbf{h})}{4\,(\omega_o\cdot\mathbf{h})}, \qquad
p_\text{Lambert}(\omega_i) = \frac{\mathbf{n}\cdot\omega_i}{\pi}
```

This is evaluated at both the BSDF-sampled direction (stored as `prevBSDFPdf`) and at the NEE-sampled direction (for the MIS denominator of the direct contribution).

#### Why Not Apply MIS to Glass Paths?

Glass is a **delta BSDF** — the reflected/refracted direction is perfectly determined by the geometry. The corresponding PDF is a Dirac delta, meaning NEE cannot sample any direction that a glass path would take. Therefore:
- No NEE is performed at glass surfaces.
- When a BSDF path through glass hits a light, the emission is added with weight 1 (`prevSpecular = true`).

---

### 14. Samplers

A **sampler** decides *where* to place each sample within the pixel and *which random values* to hand to the path tracer at every bounce. The choice has a large impact on convergence speed: a good sampler fills the sampling domain more uniformly for the same number of samples, reducing variance without changing the expected value.

#### Error bounds

| Method | Convergence rate | Type |
|--------|-----------------|------|
| Pure random (MC) | O(N⁻¹/²) | Stochastic |
| Low-discrepancy (QMC) | O((log N)ˢ / N) | Quasi-random |
| Scrambled QMC | O((log N)ˢ / N), decorrelated | Randomised QMC |

The variance of a MC estimator decreases as 1/√N — doubling quality requires 4× more samples. QMC sequences fill space more uniformly so the same budget buys noticeably less noise, especially at low SPP.

---

#### PCG32 (`IndependentSampler`)

Standard pseudo-random number generator. Each sample is statistically independent.

```
Error: O(1/√N)   Base: 2+   Dims: ∞   Cost: minimal
```

**Pros**
- Zero setup cost; no tables.
- Completely uncorrelated across samples and dimensions.
- Safe fallback — never produces structured artifacts.

**Cons**
- Slowest convergence: purely random samples cluster and leave gaps.
- No stratification across any pair of dimensions.
- At low SPP the noise is high-frequency grain.

**When to use:** debugging, reference renders, or verifying that the integrator is unbiased.

---

#### Hash (`HashSampler`)

A stateless hash-based RNG. Each pixel/pass pair re-seeds the generator from its coordinates, giving reproducible results with independent per-pixel streams.

```
Error: O(1/√N)   Base: 2+   Dims: ∞   Cost: minimal
```

**Pros**
- Deterministic: same pixel + same pass always produces the same sample.
- No shared state between pixels → trivially thread-safe.
- Slightly more uniform within a frame than PCG32 because the seed mixes spatial position.

**Cons**
- Same asymptotic convergence as PCG32 — still O(1/√N).
- Hash quality depends on the mixing function; weak hashes can alias spatially.
- No low-discrepancy guarantee.

**When to use:** debugging (reproducible frames), AOV passes where you need pixel-stable noise.

---

#### Halton (`HaltonSampler`)

A quasi-random sequence using the **radical inverse** in the first 32 prime bases (2, 3, 5, 7, …, 131), one base per dimension. Combined with **Cranley-Patterson rotation** (additive per-pixel offset mod 1) to decorrelate neighbouring pixels.

```
Error: O((log N)ˢ / N)   Base: 2,3,5,7,…   Dims: 32   Cost: low
```

The radical inverse of integer n in base b:

```
Φ_b(n) = d₁/b + d₂/b² + d₃/b³ + ...
```
where `d₁d₂d₃…` are the digits of n in base b, reflected around the decimal point. Cranley-Patterson rotation adds a per-pixel hash offset ε ∈ [0,1) before wrapping:

```
sample = fract(Φ_b(n) + ε_pixel)
```

**Pros**
- Significantly faster convergence than PCG32/Hash for the same SPP.
- Simple implementation; no precomputed tables.
- Low-discrepancy in every dimension.

**Cons**
- Quality **degrades at high dimensions**: base 31 (dim 11), base 131 (dim 31) etc. are large primes that produce long-period, poorly-stratified sequences at low sample counts.
- Correlation between dimensions that share a common factor (e.g. dim 0 base 2 and dim 1 base 3 are fine; higher bases interact poorly).
- Cranley-Patterson is an *additive* shift — it decorrelates pixels but does not preserve the digital net structure.

**When to use:** scenes with shallow paths (2–4 bounces), where only the first 8–10 dimensions matter.

---

#### Sobol (`SobolSampler`) ← **default**

A **scrambled (0,s,2)-net** in base 2. All dimensions use base 2 and are constructed from primitive polynomials over GF(2) and direction vectors (Joe-Kuo 2010 values for dims 0–12; valid polynomials for dims 13–31). Per-pixel decorrelation uses **XOR scrambling** (Burley 2020) rather than an additive shift.

```
Error: O((log N)ˢ / N)   Base: 2 (all dims)   Dims: 32   Cost: low (table ~1 KB)
```

**Direction vector recurrence** (Bratley-Fox-Joe):

```
V[b] = V[b−s] ⊕ (V[b−s] >> s) ⊕ ⊕ₖ₌₁ˢ⁻¹ cₖ · V[b−s+k]
```

where `c₁…c₢ₛ₋₁` are the middle coefficients of the primitive polynomial of degree s.

**XOR scramble** per pixel and dimension:

```
bits = sobol_uint(sample_index, dim) ⊕ hash(px, py, dim)
```

This is a random bijection on the integers — it permutes the sequence without changing its digital net property (unlike Cranley-Patterson which can break stratification).

**Pros**
- **Uniform quality across all 32 dimensions** — base 2 everywhere, no degradation at high dims.
- (0,2)-net in every pair of consecutive dims 0–12 → optimal stratification for GGX BRDF sampling and NEE, the highest-variance operations.
- XOR scrambling preserves the digital net structure, giving better stratification than Halton's CP rotation.
- Best convergence of the four options at equal SPP, especially noticeable in the first 64–256 samples.

**Cons**
- Requires precomputed direction vectors (32×32 = 1 024 `uint32_t` values, generated once at startup).
- At very high sample counts (>2¹⁶) a full Owen scrambling would be better, but hash-XOR is indistinguishable in practice.
- Slightly more complex implementation than Halton.

**When to use:** production renders, deep paths (glass, caustics), any scene where convergence speed matters.

---

#### Summary comparison

| Sampler | Convergence | Dim quality | Pixel decorr. | Cost | Best for |
|---------|------------|-------------|---------------|------|----------|
| PCG32   | O(N⁻¹/²)  | Uniform (random) | Independent | None | Debug / reference |
| Hash    | O(N⁻¹/²)  | Uniform (random) | Pixel-seeded | None | Reproducible debug |
| Halton  | O((log N)ˢ/N) | Degrades at dim >10 | CP rotation | None | Shallow paths |
| **Sobol** | **O((log N)ˢ/N)** | **Uniform all dims** | **XOR scramble** | ~1 KB table | **General use** |

---

### 15. Ray–Triangle Intersection (Möller–Trumbore)

<p align="left">
  <img src="resources/viking.png" glass="600">
  </br>
  Model: Viking Room by nigelgoh.
</p>


Given ray `r(t) = o + t·d` and triangle vertices `v0, v1, v2`:

```
e1 = v1 − v0
e2 = v2 − v0
h  = d × e2
a  = e1 · h               ← if |a| < ε: ray is parallel to triangle

f  = 1/a
s  = o − v0
u  = f · (s · h)          ← barycentric u; reject if u ∉ [0,1]

q  = s × e1
v  = f · (d · q)          ← barycentric v; reject if v < 0 or u+v > 1

t  = f · (e2 · q)         ← ray parameter; reject if t < ε (behind or self-hit)
```

The hit point is $\mathbf{p} = \mathbf{o} + t\,\mathbf{d}$. The shading normal is interpolated from per-vertex normals:

```math
\mathbf{n} = \mathrm{normalize}\!\left(\mathbf{n}_0(1-u-v) + \mathbf{n}_1\,u + \mathbf{n}_2\,v\right)
```

---

### 16. Ray–Sphere Intersection

For sphere centre $\mathbf{c}$ and radius $r$, substitute $\mathbf{r}(t)$ into $|\mathbf{p} - \mathbf{c}|^2 = r^2$:

```math
\mathbf{oc} = \mathbf{o} - \mathbf{c}, \quad b = \mathbf{oc} \cdot \mathbf{d}, \quad \Delta = b^2 - \left(|\mathbf{oc}|^2 - r^2\right)
```

If $\Delta < 0$: miss. Otherwise:

```math
t = -b - \sqrt{\Delta} \quad \text{(near root)}; \quad \text{if } t < \varepsilon,\; t = -b + \sqrt{\Delta}
```

Surface normal at hit: $\mathbf{n} = \mathrm{normalize}(\mathbf{p} - \mathbf{c})$.

---

### 17. Binary BVH

Triangle meshes are accelerated with a top-down **binary BVH** built by recursive spatial median splitting:

1. **Compute AABB** of the current triangle range.
2. **Choose split axis**: the dimension with the largest extent (`max(dx, dy, dz)`).
3. **Sort** triangle centroids along that axis.
4. **Split** at the median; recurse left and right.
5. **Leaf** when ≤ 4 triangles remain.

Traversal uses the **slab test** for AABB intersection:

```
for each axis i:
    t0 = (min[i] − o[i]) / d[i]
    t1 = (max[i] − o[i]) / d[i]
    if d[i] < 0: swap(t0, t1)
    tMin = max(tMin, t0)
    tMax = min(tMax, t1)
    if tMax ≤ tMin: miss
```

Early exit uses the current best hit `t` as `tMax`, discarding nodes that cannot improve the result.

---

### 18. Tone Mapping and Display

The accumulation buffer stores HDR linear radiance as `Vec3`. Each frame:

1. **Average** $N$ samples: $c = \text{accum}[i] / N$
2. **Reinhard** per-channel: $c' = c\,/\,(1+c)$ — maps $[0,\infty) \to [0,1)$
3. **Gamma-2** (sRGB approximation): $c'' = \sqrt{c'}$
4. **Pack** to ARGB8888: `(0xFF << 24) | (r << 16) | (g << 8) | b`
5. **Upload** via `SDL_UpdateTexture` and present with `SDL_RenderTexture`

---

### 19. Direct Lighting Mode (`renderDirect`)

`renderDirect` is an alternative render branch (enabled with the **AO** toggle in the ImGui panel) that produces a fully deterministic image in a single sample using a hand-tuned four-light Blinn-Phong rig plus SDF-based ambient occlusion.  It has no path bounces and no Monte Carlo noise, making it useful for interactive scene setup.

The final pixel colour is the sum of four independent light contributions:

```math
L = L_{\text{sun}} + L_{\text{sky}} + L_{\text{fill}} + L_{\text{rim}}
```

---

#### Ambient Occlusion (SDF)

Five sample points are lifted above the hit point $\mathbf{p}$ along the surface normal $\hat{\mathbf{n}}$ at distances $h_i$. The scene SDF $d_i$ is queried at each; a gap $h_i - d_i > 0$ means nearby geometry is blocking the sky:

```math
h_i = 0.01 + 0.12\,\frac{i}{4}, \qquad i = 0,\ldots,4
```

```math
\text{occ} = \sum_{i=0}^{4} (h_i - d_i)\,s^i, \qquad s = 0.95
```

The exponential weight $s^i$ makes closer samples more significant. The final AO term applies a horizon darkening for downward-facing normals:

```math
\text{ao} = \mathrm{clamp}(1 - 3\,\text{occ},\;0,\;1)\;\cdot\;\left(\tfrac{1}{2} + \tfrac{1}{2}\,\hat{\mathbf{n}}_y\right)
```

---

#### Light 1 — Sun (directional, hard shadow)

The sun direction $\hat{\ell}$ is a unit vector that can be animated along an orbit at elevation $\phi$ and azimuth angle $\theta$:

```math
\hat{\ell} = \begin{pmatrix} \cos\theta\cos\phi \\ \sin\phi \\ \sin\theta\cos\phi \end{pmatrix}
```

The **Blinn-Phong halfway vector** between light and eye ($\mathbf{d}$ = ray direction):

```math
\mathbf{h} = \mathrm{normalize}(\hat{\ell} - \mathbf{d})
```

**Lambertian diffuse** (clamped, zeroed if shadow ray hits anything):

```math
k_d = \mathrm{clamp}(\hat{\mathbf{n}} \cdot \hat{\ell},\;0,\;1), \qquad k_d = 0 \text{ if occluded}
```

**Blinn-Phong specular** (power 16):

```math
k_s = \mathrm{clamp}(\hat{\mathbf{n}} \cdot \mathbf{h},\;0,\;1)^{16} \cdot k_d
```

**Schlick Fresnel** on the specular term:

```math
k_s \;\leftarrow\; k_s \cdot \left[0.04 + 0.96\,(1 - \mathbf{h}\cdot\hat{\ell})^5\right]
```

**Accumulation** (warm sun colour $\mathbf{c}_\odot = (1.3,\,1.0,\,0.7)$):

```math
L_{\text{sun}} = 2.2\;k_d\;\rho\otimes\mathbf{c}_\odot \;+\; 5.0\;k_s\;\mathbf{c}_\odot
```

---

#### Light 2 — Sky (ambient + reflection specular)

Sky ambient — how much of the upper hemisphere the surface faces, modulated by AO:

```math
k_d^{\text{sky}} = \sqrt{\,\mathrm{clamp}\!\left(\tfrac{1}{2}+\tfrac{1}{2}\hat{\mathbf{n}}_y,\;0,\;1\right)}\;\cdot\;\text{ao}
```

Sky specular — how much of the upper hemisphere the reflection ray $\mathbf{r} = \mathbf{d} - 2(\mathbf{d}\cdot\hat{\mathbf{n}})\hat{\mathbf{n}}$ faces:

```math
k_s^{\text{sky}} = \mathrm{clamp}\!\left(\tfrac{1}{2}+\tfrac{1}{2}\mathbf{r}_y,\;0,\;1\right) \cdot k_d^{\text{sky}}
```

**Schlick Fresnel** using the view angle (grazing = more reflective):

```math
k_s^{\text{sky}} \;\leftarrow\; k_s^{\text{sky}} \cdot \left[0.04 + 0.96\,(1 + \hat{\mathbf{n}}\cdot\mathbf{d})^5\right]
```

If the reflection ray hits any geometry, $k_s^{\text{sky}} = 0$ (sky blocked).

**Accumulation** (sky colour $\mathbf{c}_{\text{sky}} = (0.4,\,0.6,\,1.15)$):

```math
L_{\text{sky}} = 0.6\;k_d^{\text{sky}}\;\rho\otimes\mathbf{c}_{\text{sky}} \;+\; 2.0\;k_s^{\text{sky}}\;\mathbf{c}_{\text{sky}}
```

---

#### Light 3 — Back Fill (ground-bounce GI approximation)

Simulates one indirect bounce from the floor. The fill direction $\hat{\ell}_b = \mathrm{normalize}(0.5,\,0,\,0.6)$ is the approximate opposite of the sun. Height attenuation $\max(1 - y,\,0)$ fades the contribution for objects high above the floor:

```math
k_d^{\text{fill}} = \mathrm{clamp}(\hat{\mathbf{n}}\cdot\hat{\ell}_b,\;0,\;1)\;\cdot\;\mathrm{clamp}(1-p_y,\;0,\;1)\;\cdot\;\text{ao}
```

**Accumulation** (neutral grey bounce $\mathbf{c}_b = (0.25,\,0.25,\,0.25)$):

```math
L_{\text{fill}} = 0.55\;k_d^{\text{fill}}\;\rho\otimes\mathbf{c}_b
```

---

#### Light 4 — Rim / SSS

A view-dependent term that brightens the silhouette, faking a rim backlight or subsurface scattering glow. It peaks where $\hat{\mathbf{n}}\cdot\mathbf{d} \approx 0$ (grazing angle):

```math
k_{\text{rim}} = (1 + \hat{\mathbf{n}}\cdot\mathbf{d})^2 \cdot \text{ao}
```

**Accumulation** (neutral white):

```math
L_{\text{rim}} = 0.25\;k_{\text{rim}}\;\rho
```

---

#### Analytically Box-Filtered Checkerboard

The checker albedo uses an analytic anti-aliasing technique to avoid Moiré at a distance. The 1-D filtered integral of the square-wave checker over a footprint of width $w$ centred at position $p$ is:

```math
F(p) = 2\left|\mathrm{fract}\!\left(\tfrac{p}{2}\right) - \tfrac{1}{2}\right|
```

```math
\text{checkerI}(p,w) = \frac{2\,\bigl(|a| - |b|\bigr)}{w}, \quad a = \mathrm{fract}\!\left(\tfrac{p-w/2}{2}\right)-\tfrac{1}{2},\;\; b = \mathrm{fract}\!\left(\tfrac{p+w/2}{2}\right)-\tfrac{1}{2}
```

This is the **fundamental theorem of calculus** applied to $F$: the average of the square wave over $[p-w/2,\; p+w/2]$.  The 2-D blend factor is $\text{checkerI}(p_x, w_x) \times \text{checkerI}(p_z, w_z)$, rescaled to $[0,1]$.

The filter footprint width is derived from the ray's travel distance $t$, the pixel cone half-angle $\psi$, and the grazing-angle correction $|\hat{\mathbf{n}}\cdot\mathbf{d}|$:

```math
w = \frac{t\,\psi}{\max(|\hat{\mathbf{n}}\cdot\mathbf{d}|,\;0.05)} \cdot s_{\text{checker}}
```

where $s_{\text{checker}}$ is the material's checker scale.

---

## Project Structure

```
src/
  main.cpp                  GLFW window + ImGui init + render loop
  constants.hpp             SCREEN_WIDTH, SCREEN_HEIGHT, SCENES_PATH
  app/
    scene_browser.hpp       scanScenes() — YAML directory scan, gScenePaths/gSceneNames
    input.hpp               AppState + GLFW mouse/scroll callbacks + registerInputCallbacks()
    display_texture.hpp     DisplayTexture — GL_RGBA8 texture lifecycle (create, upload, destroy)
    renderer.hpp            renderPass() — configure integrators, build sampler, dispatch
    ui.hpp                  RenderSettings · SamplerType · drawUI() — full ImGui control panel
  pt/
    math.hpp                Vec3 (all ops + operator[]), Ray
    material.hpp            Material {albedo, emission, metallic, roughness, ior, transmission}
    rng.hpp                 PCG32 (RNG) and hash-based (HashRNG) random number generators
    sampler.hpp             Sampler interface · IndependentSampler (PCG32) · HashSampler
                            · HaltonSampler (QMC, Cranley-Patterson) · SobolSampler (QMC, XOR-scramble)
    camera.hpp              Camera — orbit, setLookAt, buildFrame, generateRayFromSample
    film.hpp                Film — pixel accumulation, Reinhard tonemap, toBGRA32/toRGB8
    scene.hpp               Triangle · Sphere · AABB · BVHNode · PBRScene
    tracer.hpp              GGX helpers · tracePath() · renderDirect()
    integrator.hpp          SamplerIntegrator · PathIntegrator · DirectIntegrator
    scene_loader.hpp/.cpp   PBRSceneLoader::loadFromFile/saveToFile — tiny_yaml + tinyobjloader
  vendor/
    imgui/                  Dear ImGui 1.92 + GLFW + OpenGL3 backends
    nothings/               stb_image
    tinyobjloader/          tinyobjloader
  slib.hpp/cpp              Legacy math library (kept for unit tests)
  smath.hpp/cpp             Legacy matrix math  (kept for unit tests)

resources/
  scenes/
    spheres.yaml            3 coloured spheres + ground + area light
    cornell.yaml            Cornell box approximated with spheres
    suzanne.yaml            Blender's Suzanne mesh
    bunny.yaml              Stanford bunny
    metals.yaml             5 spheres showcasing matte / gold / mirror / copper / brushed steel
  objs/                     OBJ mesh files

tests/
  test_math.cpp             Unit tests for legacy math library
  test_pt.cpp               Unit tests for path tracer (camera, BVH, samplers)
```

---

## Scene File Format

```yaml
scene:
  name: "My Scene"

  camera:
    position: [0.0, 1.0, 4.0]   # world-space eye position
    target:   [0.0, 0.0, 0.0]   # look-at point
    fov: 45.0                    # vertical field of view (degrees)

  materials:
    - name: red_diffuse
      albedo:    [0.8, 0.1, 0.1]  # diffuse reflectance / metal tint [0..1] per channel
      emission:  [0.0, 0.0, 0.0]  # emitted radiance (set > 0 for area lights)
      metallic:  0.0              # 0 = pure diffuse, 1 = pure specular (default: 0)
      roughness: 0.0              # 0 = perfect mirror, 1 = fully rough metal (default: 0)

    - name: gold
      albedo:    [1.0, 0.78, 0.07]
      metallic:  1.0
      roughness: 0.05

    - name: warm_light
      albedo:   [0.0, 0.0, 0.0]
      emission: [12.0, 10.0, 8.0]

  objects:
    - type: sphere
      center:   [0.0, 0.0, 0.0]
      radius:   0.5
      material: red_diffuse

    - type: obj
      file:     "resources/objs/suzanne.obj"
      material: red_diffuse
```

---

## Controls

| Input | Action |
|-------|--------|
| Left-drag | Orbit camera (resets SPP) |
| Scroll wheel | Zoom in/out (resets SPP) |
| Scene combo (ImGui) | Switch scene |
| Reset button (ImGui) | Clear accumulation buffer |
| Escape | Quit |

---

## Build

Debian/Ubuntu, install these packages:

```bash
sudo apt update
sudo apt install build-essential cmake \
	libglew-dev libglfw3-dev libglm-dev libgl1-mesa-dev
```

and then run the normal CMake steps:

```bash
# Configure
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release

# Build (parallel)
cmake --build build --parallel $(nproc)

# Run from the project root so resources/ paths resolve correctly
./build/bin/PBRPathTracing
```

Windows:

1. Install dependencies with Vcpkg
	- `vcpkg install`
2. Get the vcpkg cmake toolchain file path
	- `vcpkg integrate install`
	- This will output something like : `CMake projects should use: "-DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake"`
3. Create a build directory
	- `mkdir build`
4. Configure project with CMake
	-  `cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg/scripts/buildsystems/vcpkg.cmake`
	- Use the vcpkg cmake toolchain path from above
5. Build the project
	- `cmake --build build`

### Dependencies


Vendored (in `src/vendor/`): Dear ImGui, stb_image, tinyobjloader.

### System dependencies (Linux / Raspberry Pi)

```bash
sudo apt-get install -y \
    build-essential cmake pkg-config git \
    libx11-dev libxext-dev libxrender-dev libxrandr-dev \
    libxcursor-dev libxfixes-dev libxi-dev libxss-dev \
    libxkbcommon-dev libwayland-dev wayland-protocols \
    libegl1-mesa-dev libgles2-mesa-dev libgl1-mesa-dev \
    libdrm-dev libgbm-dev libudev-dev libdbus-1-dev
```

### Unit tests

```bash
cmake --build build --target test_math
./build/bin/test_math
# or via CTest
cd build && ctest --output-on-failure
```
