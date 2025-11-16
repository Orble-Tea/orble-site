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
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

function getTexture(src: string, opts?: Partial<TextureOptions>) {
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
    value: getTexture("/cup_tex.png", { format: gl.LUMINANCE_ALPHA })
  },
  t_LUT: {
    value: getTexture("/lut.png", { generateMipmaps: false }),
  },
  t_envDiffuse: {
    value: getTexture("/waterfall-diffuse-RGBM.png", {
      generateMipmaps: false,
    })
  },
  t_envSpecular: {
    value: getTexture("/waterfall-specular-RGBM.png", {
      generateMipmaps: false,
    })
  }
};

const camera = new Camera(gl, { near: 1, far: 1000 });
camera.position = new Vec3(0, 3.5, 6.5);
const controls = new Orbit(camera);
controls.target = new Vec3(0, 1.4, 0);
// controls.enabled = false;

// TODO: do this 'properly'
function resize() {
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

async function loadInitial() {
  const modelPath = "/boba_opt.glb";
  const gltf = await GLTFLoader.load(gl, modelPath);
  console.log(gltf);

  const test = gltf.scene as Mesh[];

  bs = test.reduce((acc, node) => {
    acc[node.name] = node;
    return acc;
  }, {} as BobaScene);

  // sideObjects.forEach(
  //   (m) => ((m.children[0] as RendererSortable).program = outlineProgram)
  // );

  (bs.cup.children[0] as RendererSortable).program = plasticMat;
  (bs.lid.children[0] as RendererSortable).program = plasticMat;

  Object.values(bs).forEach((o) => o.setParent(scene));

  console.log(scene);
  requestAnimationFrame(update);
}

loadInitial();
scene.rotation.y -= 90;

// const controls = new Orbit(camera);
// const grid = new GridHelper(gl, { size: 10, divisions: 10 });
// grid.position.y = -0.001; // shift down a little to avoid z-fighting with axes helper
// grid.setParent(scene);

// const axes = new AxesHelper(gl, { size: 6, symmetric: true });
// axes.setParent(scene);

// camera.position.set(-1.5, 0.35, 2.5);
// camera.rotation.set(new Euler(...degrees(-10, -30, 0)));

// scene.rotation.set(new Euler(...degrees(8.5, 22.3, 3)));
// scene.position.set(0, -0.1, -0.3);

// ["x", "y", "z"].forEach(id =>
//   document.getElementById(id)?.addEventListener("input", setRot)
// );

// function setRot(ev: Event): void {
//   scene.rotation[ev.target.id] = degrees(ev.target.value)[0];
//   console.log(radians(...scene.rotation.toArray()));
// }

function update() {
  requestAnimationFrame(update);
  // outlineProgram.uniforms.uTime.value = time * 0.001;

  // bs.cup.rotation.y -= 0.02;
  // mesh.rotation.x += 0.03;
  // console.log(camera.position);
  // console.log(camera.rotation.x + " " + camera.rotation.y + " " + camera.rotation.z);
  controls.update();
  renderer.render({ scene, camera, sort: true });
}
