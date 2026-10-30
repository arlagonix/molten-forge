import { useEffect, useState, type CSSProperties } from "react";
import { WindowControls } from "./window-controls";
import type { BackgroundTheme } from "../core/appearance";

type LoadingScreenProps = {
  backgroundUrl: string | null;
  theme: BackgroundTheme;
  onCloseRequest?: () => void | Promise<void>;
  onVisualReady?: (backgroundUrl: string | null) => void;
};

export function LoadingScreen({ backgroundUrl, theme, onCloseRequest, onVisualReady }: LoadingScreenProps) {
  const [backgroundVisible, setBackgroundVisible] = useState(false);

  useEffect(() => {
    setBackgroundVisible(false);
    let cancelled = false;

    const reveal = () => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        setBackgroundVisible(Boolean(backgroundUrl));
        onVisualReady?.(backgroundUrl);
      });
    };

    if (!backgroundUrl) {
      reveal();
      return () => {
        cancelled = true;
      };
    }

    const image = new Image();
    image.onload = reveal;
    image.onerror = reveal;
    image.src = backgroundUrl;
    if (image.complete) reveal();

    return () => {
      cancelled = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [backgroundUrl, onVisualReady]);

  const style = backgroundUrl
    ? ({ "--loading-background-image": `url(${JSON.stringify(backgroundUrl)})` } as CSSProperties)
    : undefined;

  return (
    <main
      className={`app-loading-screen theme-${theme}${backgroundVisible ? " background-visible" : ""}`}
      style={style}
      aria-busy="true"
    >
      <div className="app-loading-background" aria-hidden="true" />
      <div className="app-loading-overlay" aria-hidden="true" />
      <div className="app-loading-titlebar" data-tauri-drag-region aria-hidden="true" />
      <WindowControls onCloseRequest={onCloseRequest} />
      <div className="app-loading-content">
        <div className="molten-forge-loading-text" aria-label="Loading app data">
          Loading...
        </div>
      </div>
    </main>
  );
}
