declare module "officeparser" {
  export function parseOfficeAsync(filePath: string, config?: unknown): Promise<unknown>;
}
