import { useEffect, useState } from "react";
import { parseScene, type Scene } from "./scenes";

export function usePageHash(): string {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return hash;
}

export function useHashScene(): Scene | null {
  const [scene, setScene] = useState<Scene | null>(() =>
    typeof window === "undefined" ? null : parseScene(window.location.hash),
  );

  useEffect(() => {
    const onHash = () => setScene(parseScene(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return scene;
}
