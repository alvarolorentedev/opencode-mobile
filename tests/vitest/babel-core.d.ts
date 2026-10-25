declare module '@babel/core' {
  export function transformSync(
    code: string,
    options?: Record<string, unknown>,
  ): { code?: string | null } | null;
}
