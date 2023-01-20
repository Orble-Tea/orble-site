#version 300 es

#include structs

// Geometry attributes
in vec3 position;
in vec2 uv;
in vec3 normal;
in vec4 tangent;
// in mat4 instanceMatrix;

// uniforms passed in by OGL
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;

// out vec2 v_uv;
// out vec3 v_normal;
// out vec4 v_tangent;

out VertexData v_vert;
out vec3 v_modelPos;
out vec4 v_modelViewPos;

void main() {
  vec4 pos = vec4(position, 1);
  vec3 nml = normal;

  // #ifdef INSTANCED
  //   pos = instanceMatrix * pos;
  //   mat3 m = mat3(instanceMatrix);
  //   nml /= vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  //   nml = m * nml;
  // #endif

  v_vert.uv = uv;
  v_vert.normal = normalize(nml);
  v_vert.tangent = tangent.xyz;
  // Use GLTF tangent data spec to correct for UV winding order.
  v_vert.bitangent = cross(normal, tangent.xyz) * tangent.w;

  vec4 modelPos = modelMatrix * pos;
  v_modelPos = modelPos.xyz / modelPos.w;
  v_modelViewPos = modelViewMatrix * pos;
  gl_Position = projectionMatrix * v_modelViewPos;
}
