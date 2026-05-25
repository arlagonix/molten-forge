import { Minus, Plus, RotateCcw } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MermaidPreviewProps = {
  source: string;
  className?: string;
  interactive?: boolean;
};

type MermaidTransform = {
  scale: number;
  x: number;
  y: number;
};

type SvgSize = {
  width: number;
  height: number;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING = 24;

function useDocumentTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.classList.contains("dark")
      ? "dark"
      : "light";
  });

  React.useEffect(() => {
    const updateTheme = () => {
      setTheme(
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

function errorMessageFromUnknown(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Failed to render Mermaid diagram.";
}

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function parsePositiveNumber(value: string | null | undefined) {
  if (!value) return undefined;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sizeFromViewBox(viewBox: string | null | undefined): SvgSize | undefined {
  if (!viewBox) return undefined;

  const [, , width, height] = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number.parseFloat(part));

  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return { width, height };
  }

  return undefined;
}

function getSvgContentSize(svg: SVGSVGElement | null): SvgSize {
  if (!svg) return { width: 800, height: 600 };

  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }

  const viewBoxSize = sizeFromViewBox(svg.getAttribute("viewBox"));
  if (viewBoxSize) return viewBoxSize;

  const width = parsePositiveNumber(svg.getAttribute("width"));
  const height = parsePositiveNumber(svg.getAttribute("height"));
  if (width && height) return { width, height };

  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }

  try {
    const bbox = (svg as unknown as SVGGraphicsElement).getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch {
    // Some SVGs cannot provide a bbox immediately.
  }

  return { width: 800, height: 600 };
}

function normalizeSvgForInteractive(svgText: string) {
  if (typeof DOMParser === "undefined") return svgText;

  try {
    const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgElement = document.querySelector("svg");

    if (!svgElement) return svgText;

    const viewBoxSize = sizeFromViewBox(svgElement.getAttribute("viewBox"));
    const width =
      viewBoxSize?.width ?? parsePositiveNumber(svgElement.getAttribute("width"));
    const height =
      viewBoxSize?.height ?? parsePositiveNumber(svgElement.getAttribute("height"));

    if (width && height) {
      svgElement.setAttribute("width", String(width));
      svgElement.setAttribute("height", String(height));
      svgElement.style.width = `${width}px`;
      svgElement.style.height = `${height}px`;
    }

    svgElement.style.maxWidth = "none";
    svgElement.style.display = "block";

    return new XMLSerializer().serializeToString(svgElement);
  } catch {
    return svgText;
  }
}

export function MermaidPreview({
  source,
  className,
  interactive = false,
}: MermaidPreviewProps) {
  const reactId = React.useId();
  const theme = useDocumentTheme();
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [svg, setSvg] = React.useState<string>();
  const [error, setError] = React.useState<string>();
  const [transform, setTransform] = React.useState<MermaidTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = React.useState(false);
  const [hasFitTransform, setHasFitTransform] = React.useState(false);

  const fitToScreen = React.useCallback(() => {
    const viewport = viewportRef.current;
    const svgElement = contentRef.current?.querySelector("svg");
    if (!viewport || !(svgElement instanceof SVGSVGElement)) return;

    const viewportRect = viewport.getBoundingClientRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return;

    const svgSize = getSvgContentSize(svgElement);
    const availableWidth = Math.max(viewportRect.width - FIT_PADDING * 2, 1);
    const availableHeight = Math.max(viewportRect.height - FIT_PADDING * 2, 1);
    const fitScale = clampScale(
      Math.min(availableWidth / svgSize.width, availableHeight / svgSize.height),
    );

    setTransform({
      scale: fitScale,
      x: (viewportRect.width - svgSize.width * fitScale) / 2,
      y: (viewportRect.height - svgSize.height * fitScale) / 2,
    });
    setHasFitTransform(true);
  }, []);

  const zoomAt = React.useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const viewportRect = viewport.getBoundingClientRect();
      const focalPoint = center ?? {
        x: viewportRect.width / 2,
        y: viewportRect.height / 2,
      };

      setTransform((current) => {
        const nextScale = clampScale(current.scale * factor);
        const scaleRatio = nextScale / current.scale;

        return {
          scale: nextScale,
          x: focalPoint.x - (focalPoint.x - current.x) * scaleRatio,
          y: focalPoint.y - (focalPoint.y - current.y) * scaleRatio,
        };
      });
    },
    [],
  );

  React.useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      const trimmedSource = source.trim();

      setError(undefined);
      setHasFitTransform(false);
      setSvg(undefined);

      if (!trimmedSource) return;

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        const id = `chat-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Math.random().toString(36).slice(2)}`;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
        });

        const result = await mermaid.render(id, trimmedSource);

        if (!cancelled) {
          setSvg(interactive ? normalizeSvgForInteractive(result.svg) : result.svg);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(errorMessageFromUnknown(caughtError));
        }
      }
    }

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [interactive, reactId, source, theme]);

  React.useLayoutEffect(() => {
    if (!interactive || !svg) return;

    fitToScreen();
  }, [fitToScreen, interactive, svg]);

  React.useEffect(() => {
    if (!interactive) return;

    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() => fitToScreen());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, [fitToScreen, interactive]);

  if (error) {
    return <div className={cn("chat-code-preview-error", className)}>{error}</div>;
  }

  if (!svg) {
    return (
      <div className={cn("chat-code-preview-loading", className)}>
        Rendering Mermaid diagram...
      </div>
    );
  }

  if (!interactive) {
    return (
      <div
        className={cn("chat-code-mermaid-preview", className)}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  return (
    <div
      className={cn(
        "chat-code-mermaid-preview chat-code-mermaid-interactive",
        className,
      )}
    >
      <div className="chat-code-mermaid-controls" aria-label="Diagram controls">
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="chat-code-action"
          onClick={() => zoomAt(1.2)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="chat-code-action"
          onClick={() => zoomAt(1 / 1.2)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          className="chat-code-action"
          onClick={fitToScreen}
          title="Fit diagram"
          aria-label="Fit diagram"
        >
          <RotateCcw className="size-3.5" />
        </Button>
        <span className="chat-code-mermaid-zoom-label" title="Current zoom">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      <div
        ref={viewportRef}
        className={cn(
          "chat-code-mermaid-viewport",
          isDragging && "chat-code-mermaid-viewport-dragging",
        )}
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;

          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsDragging(true);
          dragRef.current = {
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: transform.x,
            startY: transform.y,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;

          setTransform((current) => ({
            ...current,
            x: drag.startX + event.clientX - drag.startClientX,
            y: drag.startY + event.clientY - drag.startClientY,
          }));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
            setIsDragging(false);
          }
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
            setIsDragging(false);
          }
        }}
      >
        <div
          ref={contentRef}
          className={cn(
            "chat-code-mermaid-transform",
            !hasFitTransform && "chat-code-mermaid-transform-pending",
          )}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
