import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/** One clean URL route paired with the HTML file that backs it during local dev. */
export type HtmlRouteDefinition = {
  routePattern: RegExp;
  templatePath: string;
};

export function htmlRoutePlugin(routeDefinitions: HtmlRouteDefinition[]): Plugin {
  return {
    name: "html-route",
    configureServer(server) {
      // Vite's MPA build emits separate HTML entrypoints, but the dev server
      // doesn't map clean URLs like /start/settled or /universe back to those
      // files. This middleware bridges that gap so local dev matches the
      // deployed routing behavior (vercel.json).
      server.middlewares.use(async (request, response, next) => {
        const requestPath = request.url?.split("?")[0];
        if ((request.method !== "GET" && request.method !== "HEAD") || !requestPath) return next();

        // Fall through (don't 404) on non-matches so Vite's normal asset
        // handling and HTML entrypoint resolution still run.
        const matchingRoute = routeDefinitions.find((routeDefinition) =>
          routeDefinition.routePattern.test(requestPath),
        );
        if (!matchingRoute) return next();

        try {
          const templatePath = resolve(server.config.root, matchingRoute.templatePath);
          const template = readFileSync(templatePath, "utf-8");
          const html = await server.transformIndexHtml(requestPath, template);
          response.setHeader("Content-Type", "text/html");
          response.end(html);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}
