#version 300 es
precision highp float;

// #include colourspace

struct MaterialProps {
  float metallic, roughness, occlusion;
};

struct IBL {
  vec3 diffuse, specular;
};

in vec2 v_uv;
in vec3 v_normal;
in vec3 v_modelPos;
// in vec4 v_modelViewPos;

// uniforms passed in by OGL
uniform vec3 cameraPosition;
uniform mat4 viewMatrix;

uniform sampler2D tBaseColor, tLUT, tEnvDiffuse, tEnvSpecular;
// uniform vec3 uBaseColor;

// uniform sampler2D tRMO;
// uniform sampler2D tNormal;
// uniform float uNormalScale;
// uniform float uNormalUVScale;

out vec4 fragColor;

// TODO: decide which ones to make uniforms later
const MaterialProps props = MaterialProps(0., 0.1, 0.);
// This is a multiplier to the amount of specular.
const float uEnvSpecular = 1.;

const vec3 uLightDirection = vec3(0., 0., 1.);
const vec3 uLightColor = vec3(1.);

const float PI = 3.14159265359;
const float RECIPROCAL_PI = 0.31830988618;
const float RECIPROCAL_PI2 = 0.15915494;
const float LN2 = 0.6931472;
const float ENV_LODS = 6.0;

vec4 SRGBtoLinear(vec4 srgb) {
  vec3 linOut = pow(srgb.xyz, vec3(2.2));
  return vec4(linOut, srgb.w);
}

vec4 RGBMToLinear(vec4 value) {
  const float maxRange = 6.0;
  return vec4(value.xyz * value.w * maxRange, 1.0);
}

vec3 linearToSRGB(vec3 color) { return pow(color, vec3(1.0 / 2.2)); }

// TODO: maybe output Tangent, Bitangent, and normals + smooth normals?
vec3 getNormal() {
  // Not using normal maps right now
  // vec3 pos_dx = dFdx(v_modelViewPos.xyz);
  // vec3 pos_dy = dFdy(v_modelViewPos.xyz);
  // vec2 tex_dx = dFdx(v_uv);
  // vec2 tex_dy = dFdy(v_uv);
  // vec3 t = normalize(pos_dx * tex_dy.t - pos_dy * tex_dx.t);
  // vec3 b = normalize(-pos_dx * tex_dy.s + pos_dy * tex_dx.s);
  // mat3 tbn = mat3(t, b, normalize(v_normal));
  // vec3 n = texture(tNormal, v_uv * uNormalUVScale).rgb * 2.0 - 1.0;
  // n.xy *= uNormalScale;
  // vec3 normal = normalize(tbn * n);

  // Get world normal from view normal (normalMatrix * normal)
  // return normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  return normalize((vec4(v_normal, 0.0) * viewMatrix).xyz);
}

vec3 specularReflection(vec3 specularEnvR0, vec3 specularEnvR90, float VdH) {
  return specularEnvR0 + (specularEnvR90 - specularEnvR0) *
                             pow(clamp(1.0 - VdH, 0.0, 1.0), 5.0);
}
float geometricOcclusion(float NdL, float NdV, float roughness) {
  float r = roughness;
  float attenuationL =
      2.0 * NdL / (NdL + sqrt(r * r + (1.0 - r * r) * (NdL * NdL)));
  float attenuationV =
      2.0 * NdV / (NdV + sqrt(r * r + (1.0 - r * r) * (NdV * NdV)));
  return attenuationL * attenuationV;
}
float microfacetDistribution(float roughness, float NdH) {
  float roughnessSq = roughness * roughness;
  float f = (NdH * roughnessSq - NdH) * NdH + 1.0;
  return roughnessSq / (PI * f * f);
}
vec2 cartesianToPolar(vec3 n) {
  vec2 uv;
  uv.x = atan(n.z, n.x) * RECIPROCAL_PI2 + 0.5;
  uv.y = asin(n.y) * RECIPROCAL_PI + 0.5;
  return uv;
}

IBL getIBLContribution(float NdV, float roughness, vec3 n, vec3 reflection,
                       vec3 diffuseColor, vec3 specularColor) {
  IBL ibl;

  // TODO: moke this use mipmaps
  vec3 brdf = SRGBtoLinear(texture(tLUT, vec2(NdV, roughness))).rgb;
  vec3 diffuseLight =
      RGBMToLinear(texture(tEnvDiffuse, cartesianToPolar(n))).rgb;
  // Sample 2 levels and mix between to get smoother degradation
  float blend = roughness * ENV_LODS;
  float level0 = floor(blend);
  float level1 = min(ENV_LODS, level0 + 1.0);
  blend -= level0;

  // Sample the specular env map atlas depending on the roughness value
  vec2 uvSpec = cartesianToPolar(reflection);
  uvSpec.y /= 2.0;
  vec2 uv0 = uvSpec;
  vec2 uv1 = uvSpec;
  uv0 /= pow(2.0, level0);
  uv0.y += 1.0 - exp(-LN2 * level0);
  uv1 /= pow(2.0, level1);
  uv1.y += 1.0 - exp(-LN2 * level1);
  vec3 specular0 = RGBMToLinear(texture(tEnvSpecular, uv0)).rgb;
  vec3 specular1 = RGBMToLinear(texture(tEnvSpecular, uv1)).rgb;
  vec3 specularLight = mix(specular0, specular1, blend);
  ibl.diffuse = diffuseLight * diffuseColor;

  // Bit of extra reflection for smooth materials
  float reflectivity = pow((1.0 - roughness), 2.0) * 0.05;
  ibl.specular =
      specularLight * (specularColor * brdf.x + brdf.y + reflectivity);
  ibl.specular *= uEnvSpecular;

  return ibl;
}

void main() {
  vec4 tex = SRGBtoLinear(texture(tBaseColor, v_uv));
  vec3 baseColor = tex.rgb;
  // For PBR texture mapping
  // RMO map packed as rgb = [roughness, metallic, occlusion]
  // vec4 rmaSample = texture(tRMO, v_uv);
  // float roughness = clamp(rmaSample.r * props.roughness, 0.04, 1.0);
  // float metallic = clamp(rmaSample.g * props.metallic, 0.04, 1.0);

  // Defined by GLTF spec
  vec3 f0 = vec3(0.04);
  // Lambertian diffuse
  // TODO: http://stack.gl/packages/#stackgl/glsl-diffuse-oren-nayar
  vec3 diffuseColor = baseColor * (vec3(1.0) - f0) * (1.0 - props.metallic);

  vec3 specularColor = mix(f0, baseColor, props.metallic);
  vec3 specularEnvR0 = specularColor;
  vec3 specularEnvR90 = vec3(
      clamp(max(max(specularColor.r, specularColor.g), specularColor.b) * 25.0,
            0.0, 1.0));

  // Incidence Rays (Vectors)
  vec3 N = getNormal();
  vec3 V = normalize(cameraPosition - v_modelPos);
  vec3 L = normalize(uLightDirection);
  vec3 H = normalize(L + V);
  vec3 reflection = normalize(reflect(-V, N));

  float NdL = clamp(dot(N, L), 0.001, 1.0);
  float NdV = clamp(abs(dot(N, V)), 0.001, 1.0);
  float NdH = clamp(dot(N, H), 0.0, 1.0);
  float LdH = clamp(dot(L, H), 0.0, 1.0);
  float VdH = clamp(dot(V, H), 0.0, 1.0);

  // BRDF calculation
  vec3 F = specularReflection(specularEnvR0, specularEnvR90, VdH);
  float G = geometricOcclusion(NdL, NdV, props.roughness);
  float D = microfacetDistribution(props.roughness, NdH);
  vec3 diffuseContrib = (1.0 - F) * (diffuseColor / PI);
  vec3 specContrib = F * G * D / (4.0 * NdL * NdV);

  // Shading based off lights
  vec3 color = NdL * uLightColor * (diffuseContrib + specContrib);
  // Get base alpha
  float alpha = 1.0;
  alpha *= tex.a;
  // Add lights specular to alpha for reflections on transparent surfaces
  // (glass)
  alpha = max(alpha, max(max(specContrib.r, specContrib.g), specContrib.b));

  // Calculate IBL (Image Based Lighting)
  IBL ibl = getIBLContribution(NdV, props.roughness, N, reflection,
                               diffuseColor, specularColor);
  // Add IBL on top of color
  color += ibl.diffuse + ibl.specular;
  // Add IBL specular to alpha for reflections on transparent surfaces (glass)
  alpha = max(alpha, max(max(ibl.specular.r, ibl.specular.g), ibl.specular.b));

  // Multiply occlusion
  // color = mix(color, color * rmaSample.b, props.occlusion);

  // Add emissive on top
  // vec3 emissive = SRGBtoLinear(texture(tEmissive, v_uv)).rgb * uEmissive;
  // color += emissive;

  // Convert to sRGB to display
  // fragColor.rgb = linearToSRGB(color);
  fragColor.rgb = linearToSRGB(color);
  fragColor.a = alpha;
  fragColor.a = 1.;

  // Apply uAlpha uniform at the end to overwrite any specular additions on
  // transparent surfaces
  // fragColor.a = alpha * uAlpha;
}
