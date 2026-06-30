import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { getModel, getHeading, getPitch, type ModelSlot } from "./modelStore";

/**
 * Live orientation preview for an uploaded fish model. Shows the model at its
 * current heading + pitch (read every frame, so it updates the instant the
 * ↻/⤧ buttons are clicked) together with a forward arrow — the direction the
 * fish swims. The user just rotates the head to point along the arrow.
 */
export function OrientPreview({ slot, size = 132 }: { slot: ModelSlot; size?: number }) {
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
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));
      const dl = new THREE.DirectionalLight(0xffffff, 0.7);
      dl.position.set(2, 3, 2);
      scene.add(dl);
      const cam = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
      cam.position.set(0.5, 0.7, 3.1);
      cam.lookAt(0, 0, 0);

      // Forward arrow: the swim direction the fish's head should point toward.
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1.15, 0, 0),
        2.3,
        0xe06a4a,
        0.34,
        0.22
      );
      scene.add(arrow);

      const buf = await (await fetch(url)).arrayBuffer();
      if (disposed) return;
      new GLTFLoader().parse(buf, "", (g) => {
        if (disposed) return;
        const obj = g.scene;
        const box = new THREE.Box3().setFromObject(obj);
        const sz = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(sz.x, sz.y, sz.z) || 1;
        const s = 1 / maxDim;
        obj.scale.setScalar(s);
        obj.position.copy(center).multiplyScalar(-s);
        const group = new THREE.Group();
        group.add(obj);
        scene.add(group);

        const loop = () => {
          if (disposed) return;
          // Replicate the engine's per-frame orientation for a fish swimming
          // toward +X (the arrow), minus the swim wobble.
          group.rotation.set(0, 0, 0);
          group.lookAt(1, 0, 0);
          group.rotateY(Math.PI / 2 + getHeading(slot));
          const p = getPitch(slot);
          if (p) group.rotateX(p);
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
