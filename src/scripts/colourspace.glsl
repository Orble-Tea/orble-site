
vec4 SRGBtoLinear(vec4 srgb) {
  vec3 linOut = pow(srgb.xyz, vec3(2.2));
  return vec4(linOut, srgb.w);
}

vec4 RGBMToLinear(vec4 value) {
  const float maxRange = 6.0;
  return vec4(value.xyz * value.w * maxRange, 1.0);
}

vec3 linearToSRGB(vec3 color) { return pow(color, vec3(1.0 / 2.2)); }
