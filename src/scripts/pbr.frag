#version 300 es
precision highp float;

// #include colourspace

struct VertexData {
  vec3 tangent;
  vec3 bitangent;
  vec3 normal;
  vec2 uv;
};

float clampedDot(vec3 x, vec3 y) { return clamp(dot(x, y), 0.0, 1.0); }

struct TBN {
  vec3 tangent;   // Geometry tangent
  vec3 bitangent; // Geometry bitangent
  vec3 normal;    // Geometry normal
  // vec3 normal_s;  // Shading normal
  // vec3 normaltex; // Normal from texture, scaling is accounted for.
};

struct MaterialInfo {
  float ior;
  float perceptualRoughness; // roughness value, as authored by the model
                             // creator (input to shader)
  vec3 f0;                   // full reflectance color (n incidence angle)

  float alphaRoughness; // roughness mapped to a more linear change in the
                        // roughness (proposed by [2])
  vec3 c_diff;

  vec3 f90; // reflectance color at grazing angle
  float metallic;

  vec3 baseColour;

  float sheenRoughnessFactor;
  vec3 sheenColorFactor;

  vec3 clearcoatF0;
  vec3 clearcoatF90;
  float clearcoatFactor;
  vec3 clearcoatNormal;
  float clearcoatRoughness;

  // KHR_materials_specular
  float specularWeight; // product of specularFactor and specularTexture.a

  float transmissionFactor;

  float thickness;
  vec3 attenuationColor;
  float attenuationDistance;

  // KHR_materials_iridescence
  float iridescenceFactor;
  float iridescenceIor;
  float iridescenceThickness;
};

MaterialInfo getIorInfo(MaterialInfo info) {
  info.f0 = vec3(pow((u_Ior - 1.0) / (u_Ior + 1.0), 2.0));
  info.ior = u_Ior;
  return info;
}

// struct MaterialProps {
//   float metallic, roughness, occlusion;
// };

uniform sampler2D t_baseColour, t_LUT, t_envDiffuse, t_envSpecular;

in VertexData v_vert;
in vec3 v_modelPos;
in vec4 v_modelViewPos;

// uniforms passed in by OGL
uniform vec3 u_cameraPosition;
uniform mat4 u_viewMatrix;

out vec4 g_finalColour;

// Get normal, tangent and bitangent vectors.
TBN getNormalInfo() {
  // Normalize vertex data since it's linearly interpolated.
  TBN ni = TBN(normalize(v_vert.tangent), normalize(v_vert.bitangent),
               normalize(v_vert.normal));

  // For a back-facing surface, the tangential basis vectors are negated.
  if (gl_FrontFacing == false) {
    ni.tangent *= -1.0;
    ni.bitangent *= -1.0;
    ni.normal *= -1.0;
  }

  return ni;
}

void main() {
  // vec4 baseColour = vec4(1.);
  vec4 baseColour = texture(t_baseColour, v_vert.uv);

  vec3 v = normalize(u_cameraPosition - v_modelPos);

  TBN tbn = getNormalInfo();

  float TdotV = clampedDot(tbn.tangent, v);
  float BdotV = clampedDot(tbn.bitangent, v);
  float NdotV = clampedDot(tbn.normal, v);

  MaterialInfo materialInfo;
  materialInfo.baseColour = baseColour.rgb;

  // The default index of refraction of 1.5 yields a dielectric normal incidence
  // reflectance of 0.04.
  materialInfo.ior = 1.5;
  materialInfo.f0 = vec3(0.04);
  materialInfo.specularWeight = 1.0;

  g_finalColour = baseColour; // tbn.tangent; // vec3(TdotV);
  // g_finalColour.a = 1.;
}
