import { Router } from "express";
import fs from "fs";
import path from "path";

export class IndexRouter {
  private _router: Router;

  constructor() {
    this._router = Router();
    this.loadRoutes();
  }

  private loadRoutes(): void {
    const routesPath = path.join(__dirname); // points to routes folder (e.g., src/routes or dist/routes)

    // Scan folders inside routes/
    const folders = fs
      .readdirSync(routesPath)
      .filter((file) => fs.statSync(path.join(routesPath, file)).isDirectory());

    folders.forEach((folder) => {
      const baseName = `${folder}.router`;
      const tsPath = path.join(routesPath, folder, `${baseName}.ts`);
      const jsPath = path.join(routesPath, folder, `${baseName}.js`);

      let filePath = "";
      if (fs.existsSync(tsPath)) {
        filePath = tsPath;
      } else if (fs.existsSync(jsPath)) {
        filePath = jsPath;
      } else {
        console.warn(`[⚠] No route file found for: ${folder}`);
        return;
      }

      try {
        const module = require(filePath);

        const RouterClass =
          module.default ||
          Object.values(module).find((e) => typeof e === "function");

        if (RouterClass) {
          const instance = new RouterClass();
          this._router.use(`/${folder}`, instance.router);
          console.log(
            `[✔] Route mounted: /${folder} → ${path.basename(filePath)}`,
          );
        } else {
          console.warn(`[⚠] No class exported in: ${filePath}`);
        }
      } catch (err) {
        console.error(`[❌] Failed to load router at: ${filePath}`);
        console.error(err);
      }
    });
  }

  public get router(): Router {
    return this._router;
  }
}
