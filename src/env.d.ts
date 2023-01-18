/// <reference types="@astrojs/image/client" />

declare module '*.vert' {
  const vertexShader: string;
  export default vertexShader;
}

declare module '*.frag' {
  const fragShader: string;
  export default fragShader;
}
