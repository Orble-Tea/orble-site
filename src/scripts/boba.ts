import {
  Post,
  Renderer,
  Camera,
  Transform,
  Program,
  GLTFLoader,
  Vec2,
  Vec4,
  Euler,
  RendererSortable,
  Mesh,
  Orbit,
} from "ogl";

import vert from "./standard.vert"
import frag from "./plastic.frag"

function degrees(...angles: number[]): number[] {
  return angles.map((r) => (r * Math.PI) / 180);
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
  uTime: { value: 0 },
  uResolution: { value: new Vec2(gl.canvas.width, gl.canvas.height) },
};

const camera = new Camera(gl, { near: 1, far: 1000 });
camera.position.z = 3;
const controls = new Orbit(camera);

// TODO: do this 'properly'
function resize() {
  renderer.setSize(el?.clientWidth!, el?.clientHeight!);
  uniforms.uResolution.value.set(gl.canvas.width, gl.canvas.height);
  const aspect = gl.canvas.width / gl.canvas.height;
  camera.perspective({
    aspect: gl.canvas.width / gl.canvas.height,
  });
}

window.addEventListener("resize", resize, false);
resize();

const scene = new Transform();

// const solid = (colour: Vec4) =>
//   new Program(gl, {
//     vertex: vertex,
//     fragment: solid_frag,
//     uniforms: {
//       uColour: { value: colour },
//     },
//     transparent: true,
//     cullFace: false,
//   });

const plasticMat = new Program(gl, {
  vertex: vert,
  fragment: frag,
  uniforms: uniforms,
  transparent: true,
  cullFace: false,
});

interface GLTFTransform extends Transform {
  name: string
}

interface BobaScene {
  [key: string]: GLTFTransform
  cup: GLTFTransform
  lid: GLTFTransform
  stars: GLTFTransform
  tea: GLTFTransform
  boba: GLTFTransform
};

async function loadInitial() {
  const modelPath = "/boba_mat.glb";
  const gltf = await GLTFLoader.load(gl, modelPath);
  console.log(gltf);

  const test = gltf.scene as Mesh[];

  const bs = test.reduce((acc, node) => {
    acc[node.name] = node;
    return acc;
  }, {} as BobaScene);

  // sideObjects.forEach(
  //   (m) => ((m.children[0] as RendererSortable).program = outlineProgram)
  // );

  (bs.cup.children[0] as RendererSortable).program = plasticMat;

  Object.values(bs).forEach(o => o.setParent(scene));

  console.log(scene);
  requestAnimationFrame(update);
}

loadInitial();

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

function update(time: number) {
  requestAnimationFrame(update);
  // outlineProgram.uniforms.uTime.value = time * 0.001;

  scene.rotation.y -= 0.02;
  // mesh.rotation.x += 0.03;
  // console.log(camera.position);
  // console.log(camera.rotation.x + " " + camera.rotation.y + " " + camera.rotation.z);
  controls.update();
  renderer.render({ scene, camera, sort: true});
}
