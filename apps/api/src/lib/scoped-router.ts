import type { RequestHandler } from "express";

export function pathMatches(path: string, prefixes: readonly string[]) {
  return prefixes.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

export const onlyPaths = (prefixes: readonly string[], handler: RequestHandler): RequestHandler =>
  (req, res, next) => pathMatches(req.path, prefixes) ? handler(req, res, next) : next();
