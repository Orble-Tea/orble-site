#version 300 es

in vec3 position;
in vec2 uv;
in vec3 normal;
// in mat4 instanceMatrix;

// uniforms passed in by OGL
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;

out vec2 v_uv;
out vec3 v_normal;
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

  v_uv = uv;
  v_normal = normalize(nml);
  vec4 modelPos = modelMatrix * pos;
  v_modelPos = modelPos.xyz / modelPos.w;
  v_modelViewPos = modelViewMatrix * pos;
  gl_Position = projectionMatrix * v_modelViewPos;
}
