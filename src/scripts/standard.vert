#version 300 es
in vec3 position;
in vec2 uv;
in vec3 normal;
// in mat4 instanceMatrix;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;

out vec2 vUv;
out vec3 vNormal;
out vec3 vMPos;
out vec4 vMVPos;

void main() {
  vec4 pos = vec4(position, 1);
  vec3 nml = normal;

  // #ifdef INSTANCED
  //   pos = instanceMatrix * pos;
  //   mat3 m = mat3(instanceMatrix);
  //   nml /= vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  //   nml = m * nml;
  // #endif

  vUv = uv;
  vNormal = normalize(nml);
  vec4 mPos = modelMatrix * pos;
  vMPos = mPos.xyz / mPos.w;
  vMVPos = modelViewMatrix * pos;
  gl_Position = projectionMatrix * vMVPos;
}
