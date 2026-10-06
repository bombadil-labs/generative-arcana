import { useLayoutEffect, useState } from "react";
import { getPackArtworkImage, type PackArtworkAsset } from "./api";

type ImageState = { asset: PackArtworkAsset; scope: unknown; url: string; loaded: boolean; release(): void };
/** Display only fetched, checked WebP bytes. Each resource owns and releases its object URL. */
export function PackAssetImage({ asset, scope, alt, fallback }: { asset?: PackArtworkAsset | null; scope: unknown; alt: string; fallback: React.ReactNode }) {
  const [image, setImage] = useState<ImageState | null>(null);
  const current = image && image.asset === asset && image.scope === scope ? image : null;
  useLayoutEffect(() => {
    const controller = new AbortController();
    let url: string | null = null;
    const release = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
    setImage(null);
    if (asset) void getPackArtworkImage(asset, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setImage({ asset, scope, url, loaded: false, release });
    }).catch(() => { /* Missing, denied and corrupt images keep the trusted fallback. */ });
    return () => { controller.abort(); release(); };
  }, [asset, scope]);
  // Zero-minimum tracks keep intrinsic image dimensions from expanding the preview.
  return <div style={{ position: "relative", width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", display: "grid", gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
    {!current?.loaded && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{fallback}</div>}
    {current && <img key={current.url} src={current.url} alt={alt} draggable={false} aria-hidden={!current.loaded} style={{ position: "absolute", inset: 0, minWidth: 0, minHeight: 0, width: "100%", height: "100%", objectFit: "contain", display: "block", opacity: current.loaded ? 1 : 0 }} onLoad={() => {
      setImage((previous) => previous === current ? { ...previous, loaded: true } : previous);
    }} onError={() => {
      current.release();
      setImage((previous) => previous?.url === current.url ? null : previous);
    }} />}
  </div>;
}
