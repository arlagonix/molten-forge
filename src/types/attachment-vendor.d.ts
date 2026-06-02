declare module "7zip-bin" {
  const value: { path7za: string };
  export default value;
}

declare module "node-7z" {
  import type { EventEmitter } from "node:events";

  type SevenOptions = {
    $bin?: string;
    recursive?: boolean;
  };

  const Seven: {
    extractFull: (
      archivePath: string,
      outputDir: string,
      options?: SevenOptions,
    ) => EventEmitter;
  };

  export default Seven;
}

declare module "pdf-parse" {
  function pdfParse(buffer: Buffer): Promise<{ text: string }>;
  export default pdfParse;
}
