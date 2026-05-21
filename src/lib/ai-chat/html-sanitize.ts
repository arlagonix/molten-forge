const PREVIEW_DOCUMENT_STYLES = `
  :root {
    color-scheme: light dark;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.5;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    padding: 16px;
    color: CanvasText;
    background: Canvas;
  }

  table {
    border-collapse: collapse;
    max-width: 100%;
  }

  th,
  td {
    border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
    padding: 4px 8px;
    vertical-align: top;
  }

  img,
  video,
  canvas {
    max-width: 100%;
    height: auto;
  }

  pre,
  code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
`;

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "img-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
].join("; ");

export async function sanitizeHtmlPreviewSource(source: string) {
  const domPurifyModule = await import("dompurify");
  const DOMPurify = domPurifyModule.default;

  return DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: false,
    FORBID_TAGS: [
      "base",
      "embed",
      "frame",
      "frameset",
      "iframe",
      "link",
      "math",
      "meta",
      "object",
      "script",
      "svg",
    ],
    FORBID_ATTR: ["srcdoc"],
  });
}

export function buildHtmlPreviewDocument(sanitizedHtml: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}" />
    <style>${PREVIEW_DOCUMENT_STYLES}</style>
  </head>
  <body>${sanitizedHtml}</body>
</html>`;
}
