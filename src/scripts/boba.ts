import {
  Renderer,
  Camera,
  Transform,
  Texture,
  Program,
  GLTFLoader,
  RendererSortable,
  Mesh,
  Orbit,
  Vec3,
  TextureOptions,
} from "ogl";

import vert from "./standard.vert";
import pbr from "./pbr.frag";

// See https://stackoverflow.com/a/66180709
/**
 * Load an image and return a promise that resolves with the HTMLImageElement.
 * @param src - URL or path to the image
 * @returns Promise<HTMLImageElement>
 */
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    /**
     * Called when the image loads successfully.
     * @returns {void} Nothing is returned; resolves the parent promise.
     */
    img.onload = (): void => resolve(img);

    /**
     * Called if the image fails to load.
     * @param {Event | string} err - The error event or message.
     * @returns {void} Nothing is returned; rejects the parent promise.
     */
    img.onerror = (err: Event | string): void => reject(err);
    img.src = src;
  });

/**
 * Create an OGL Texture and asynchronously load the image into it.
 * @param src - image path
 * @param opts - optional TextureOptions
 * @returns Texture
 */
function getTexture(src: string, opts?: Partial<TextureOptions>): Texture {
  const texture = new Texture(gl, opts);
  texture.flipY = false;
  loadImage(src).then((img) => (texture.image = img));
  return texture;
}

const renderer = new Renderer({
  antialias: true,
  alpha: true,
  dpr: window.devicePixelRatio,
  autoClear: true,
});
const gl = renderer.gl;
const el = document.getElementById("3D");
el?.appendChild(gl.canvas);
gl.clearColor(1.0, 1.0, 1.0, 0.0);
// gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);

// const post = new Post(gl);

const uniforms = {
  t_baseColour: {
    value: getTexture("/cup_tex.png", { format: gl.LUMINANCE_ALPHA }),
  },
  t_LUT: {
    value: getTexture("/lut.png", { generateMipmaps: false }),
  },
  t_envDiffuse: {
    value: getTexture("/waterfall-diffuse-RGBM.png", {
      generateMipmaps: false,
    }),
  },
  t_envSpecular: {
    value: getTexture("/waterfall-specular-RGBM.png", {
      generateMipmaps: false,
    }),
  },
};

const camera = new Camera(gl, { near: 1, far: 1000 });
camera.position = new Vec3(0, 3.5, 6.5);
const controls = new Orbit(camera);
controls.target = new Vec3(0, 1.4, 0);
// controls.enabled = false;

// TODO: do this 'properly'
/**
 * Resize the renderer and update the camera perspective.
 * This should be called on window resize events.
 */
function resize(): void {
  if (el) {
    renderer.setSize(el.clientWidth, el.clientHeight);
    camera.perspective({
      aspect: gl.canvas.width / gl.canvas.height,
    });
  }
  camera.perspective({
    aspect: gl.canvas.width / gl.canvas.height,
  });
}

window.addEventListener("resize", resize, false);
resize();

const scene = new Transform();

const plasticMat = new Program(gl, {
  vertex: vert,
  fragment: pbr,
  uniforms: uniforms,
  transparent: true,
  cullFace: false,
});

interface GLTFTransform extends Transform {
  name: string;
}

interface BobaScene {
  [key: string]: GLTFTransform;
  cup: GLTFTransform;
  lid: GLTFTransform;
  stars: GLTFTransform;
  tea: GLTFTransform;
  boba: GLTFTransform;
}

let bs: BobaScene;

/**
 * Load the initial GLTF model and set up scene materials.
 * @returns Promise<void>
 */
async function loadInitial(): Promise<void> {
  const modelPath = "/boba_opt.glb";
  const gltf = await GLTFLoader.load(gl, modelPath);
  console.log(gltf);

  const test = gltf.scene as Mesh[];

  bs = test.reduce((acc, node) => {
    acc[node.name] = node;
    return acc;
  }, {} as BobaScene);

  (bs.cup.children[0] as RendererSortable).program = plasticMat;
  (bs.lid.children[0] as RendererSortable).program = plasticMat;

  Object.values(bs).forEach((o) => o.setParent(scene));

  console.log(scene);
  requestAnimationFrame(update);
}

loadInitial();
scene.rotation.y -= 90;

/**
 * Frame loop: update controls and render the scene.
 */
function update(): void {
  requestAnimationFrame(update);
  controls.update();
  renderer.render({ scene, camera, sort: true });
}
