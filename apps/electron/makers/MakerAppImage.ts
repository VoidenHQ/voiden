import { ElectronBuilderForgeMaker, type ForgeMakerTarget, type ForgePlatform } from "app-builder-lib";

/**
 * Builds the Linux AppImage with app-builder-lib's own AppImage target.
 *
 * Replaces @pengx17/electron-forge-maker-appimage, which imports
 * `app-builder-lib/out/util/appBuilder` — removed in app-builder-lib 26 — and so
 * pins the tree to app-builder-lib 24 (GHSA for AppImages built by < 26.15.0).
 * electron-builder's published forge makers still use the Forge 5 function-export
 * shape, so this subclasses the Forge 6+ base class app-builder-lib ships instead.
 *
 * Output lands directly in Forge's makeDir as `voiden-<version>.AppImage`, which is
 * where and how republish.js looks for it.
 */
export class MakerAppImage extends ElectronBuilderForgeMaker {
  readonly name = "appImage";
  readonly defaultPlatforms: ForgePlatform[] = ["linux"];

  isSupportedOnCurrentPlatform(): boolean {
    return process.platform === "linux";
  }

  protected getTarget(targetArch: string): ForgeMakerTarget {
    return {
      linux: [`AppImage:${targetArch}`],
      config: {
        protocols: [{ name: "Voiden", schemes: ["voiden"] }],
        appImage: {
          artifactName: "${name}-${version}.${ext}",
          // electron-builder defaults these to package.json "name" (voiden); the
          // window class Electron sets is productName, so docks only link the
          // running window to this launcher when they match.
          desktop: { entry: { Name: "Voiden", StartupWMClass: "Voiden" } },
        },
      },
    };
  }
}
