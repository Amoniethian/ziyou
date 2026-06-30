import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getModel, type ModelSlot } from "./modelStore";

/**
 * Small spinning preview of an uploaded GLB, shown on the 物种 page.
 * Three.js is already loaded for the main aquarium, so this adds no extra
 * download — and it only mounts for slots that actually have a custom model.
 */
export function ModelThumb({ slot, size = 46 }: { slot: ModelSlot; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;

    (async () => {
      const url = await getModel(slot);
      if (!url || !ref.current || disposed) return;
      renderer = new THREE.WebGLRenderer({ canvas: ref.current, antialias: true, alpha: true });
      renderer.setSize(size, size, false);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 0.95));
      const dl = new THREE.DirectionalLight(0xffffff, 0.8);
      dl.position.set(2, 3, 2);
      scene.add(dl);
      const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 100);

      const buf = await (await fetch(url)).arrayBuffer();
      if (disposed) return;
      new GLTFLoader().parse(buf, "", (g) => {
        if (disposed) return;
        const obj = g.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const sz = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
        obj.position.sub(center);
        const root = new THREE.Group();
        root.add(obj);
        scene.add(root);
        const d = maxDim * 1.7;
        cam.position.set(d, d * 0.45, d);
        cam.lookAt(0, 0, 0);

        let mixer: THREE.AnimationMixer | null = null;
        if (g.animations?.length) {
          mixer = new THREE.AnimationMixer(obj);
          g.animations.forEach((c) => mixer!.clipAction(c).play());
        }
        const clock = new THREE.Clock();
        const loop = () => {
          if (disposed) return;
          root.rotation.y += 0.02;
          mixer?.update(clock.getDelta());
          renderer!.render(scene, cam);
          raf = requestAnimationFrame(loop);
        };
        loop();
      });
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer?.dispose();
    };
  }, [slot, size]);

  return <canvas ref={ref} width={size} height={size} style={{ width: size, height: size }} />;
}
