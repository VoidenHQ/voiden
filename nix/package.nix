{ pkgs, lib, stdenv, makeWrapper, electron, git, nodejs_22, python3, libtool, fetchurl
, pluginSources ? {}, pluginRegistrySrc ? null
}:

let
  # Force yarnProject to build with Node 22. This matches the devShell
  # and avoids V8 API incompatibilities in dependencies (like macos-alias)
  # that occur under newer Node 24 versions.
  yarnProject = pkgs.callPackage ../yarn-project.nix {
    nodejs = nodejs_22;
  } {
    src = lib.cleanSource ../.;
  };

  buildPlugin = pkgs.callPackage ./plugins.nix {};

  # npmDepsHash per plugin — a hash of each plugin repo's package-lock.json
  # dependency tree (see prefetch-npm-deps), NOT of the source itself. Only
  # needs updating if that specific plugin's package-lock.json changes;
  # bumping the plugin's flake input rev alone does not invalidate it.
  pluginNpmDepsHashes = {
    md-preview = "sha256-Kmuo2F9ANY8YStRZ/x9DUIpa8SlXF/Rk+Hlxrw9uRNo=";
    openapi-import = "sha256-TXy2RS5B53GUCDysKxkfzftm/sgrUOR5VGnh9zolmAI=";
    postman-import = "sha256-qHcEtS8IV2tcgMk2dGSKpfjjMbE/B3suCbiPws8SkwM=";
    simple-assertions = "sha256-N5DPsOSxB3k9GHJyt4BYeE7HjnlBITNEziaRmviMj0g=";
    voiden-advanced-auth = "sha256-rhUXjsCMCTBMLx1hVceRBk8kg4wroACZgiPhcIQWQVs=";
    voiden-faker = "sha256-znjKDg/xtqfZfERUSmIVmBfnlAQp9vxEyENb3SInpZw=";
    voiden-graphql = "sha256-S7uaOT+PuiYc81X0iLYWqeDrR9ylqTGX3aPDHa+0B3c=";
    voiden-rest-api = "sha256-1HwAftFdML0ck5zm1WAWxMY6sZCcOAr7gpzSHFW7+7M=";
    voiden-scripting = "sha256-PuPUt1zpwyzx5WIHW2F0DwhMYnnChLbtigzNQPvyrGE=";
    voiden-sockets-grpcs = "sha256-ayLnko5SGQNj3JIV5xiDDGgVti4kpWxAxkCSDx1XDDQ=";
    # Updated after VoidenHQ/plugin-voiden-stitch@e30a71d fixed its lockfile
    # (missing xlsx-js-style — see that repo's commit for detail).
    voiden-stitch = "sha256-+T68TUzFLJ+zr1fokcV2wcBbqpY//v2MfdUEo85iGs8=";
  };

  preparedPlugins = lib.mapAttrs (id: src: buildPlugin {
    inherit id src;
    npmDepsHash = pluginNpmDepsHashes.${id};
  }) pluginSources;

  # yarn-project.nix points node-gyp at nodejs_22's headers (npm_config_nodedir)
  # so native addons build against plain Node's ABI. But the app actually runs
  # under Nixpkgs' `electron`, whose bundled Node/V8 has its own, different
  # NODE_MODULE_VERSION (e.g. Electron 41.7.2 -> 145 vs. Node 22 -> 127). Any
  # native module compiled against nodejs_22 (node-pty, etc.) then fails to
  # load at runtime with a NODE_MODULE_VERSION mismatch. Fetching Electron's
  # own published headers and pointing node-gyp at those instead — below —
  # makes native addons build against the ABI Electron actually needs.
  electronHeaders = stdenv.mkDerivation {
    pname = "electron-headers";
    version = electron.version;
    src = fetchurl {
      url = "https://artifacts.electronjs.org/headers/dist/v${electron.version}/node-v${electron.version}-headers.tar.gz";
      hash = "sha256-0nUJBQDEikyYntZwq+ycH32mzEQtQmz3ICz9eeTMpJk=";
    };
    sourceRoot = "node_headers";
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''
      mkdir -p $out
      cp -r . $out/
    '';
  };
in
yarnProject.overrideAttrs (oldAttrs: {
  name = "voiden";

  # Bypasses the postinstall download step of the electron NPM module
  # which would fail inside the network-disabled sandbox environment.
  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  # Overrides drvCommon's nodejs_22-pointing npm_config_nodedir (see
  # electronHeaders above) so native modules compile against Electron's ABI
  # instead of plain Node's.
  npm_config_nodedir = electronHeaders;
  npm_config_target = electron.version;
  npm_config_runtime = "electron";

  # nativeBuildInputs: 
  # - GNU libtool is added on Linux. 
  # - On Darwin, GNU libtool is omitted because it overrides/shadows the 
  #   system's Apple libtool. Apple's libtool is required by tree-sitter 
  #   to build static archives via the '-static' flag, which is provided by pkgs.cctools.
  nativeBuildInputs = (oldAttrs.nativeBuildInputs or []) ++ [ makeWrapper ]
    ++ lib.optionals stdenv.isLinux [ libtool ]
    ++ lib.optionals stdenv.isDarwin [ pkgs.cctools ];

  # buildInputs: 
  # - pkgs.apple-sdk is included on Darwin to automatically resolve 
  #   Apple framework dependencies (CoreServices, Cocoa, etc.) for native modules.
  buildInputs = (oldAttrs.buildInputs or []) ++ [ python3 ]
    ++ lib.optionals stdenv.isDarwin [ pkgs.apple-sdk ];

  buildPhase = ''
    runHook preBuild

    # node_modules/.bin scripts still have their original "#!/usr/bin/env node"
    # shebangs at this point — fixupPhase's automatic patchShebangs only runs
    # after install. Linux's build sandbox has no /usr/bin/env at all (unlike
    # Darwin, where it's part of the base system), so invoking esbuild here
    # (via `yarn workspace voiden build:nix`) fails with "bad interpreter"
    # unless we patch shebangs ourselves first.
    patchShebangs node_modules

    # Assemble plugins/<id>/ from the pinned flake inputs (each already has its
    # own hermetic `npm ci` done — see nix/plugins.nix) — the same directory
    # layout cleanup.sh's live `git clone` + `npm install` normally produces.
    # Copied (not symlinked) since scripts/build-plugins.mjs writes dist/
    # output back into each plugin's own directory, and Nix store paths are
    # read-only.
    mkdir -p plugins
    ${lib.concatStringsSep "\n" (lib.mapAttrsToList (id: drv: ''
      cp -r ${drv} plugins/${id}
      chmod -R u+w plugins/${id}
    '') preparedPlugins)}
    ${lib.optionalString (pluginRegistrySrc != null) ''
      cp -r ${pluginRegistrySrc} plugins/plugin-registry
      chmod -R u+w plugins/plugin-registry
    ''}
    patchShebangs plugins

    # Build every plugin's renderer bundle (plugins/<id>/dist/<id>.js) — the
    # same script forge.config.ts's generateAssets hook calls for a normal
    # build, so plugin bundles get identical host-shimming/manifest-injection.
    node scripts/build-plugins.mjs

    # Build main-process bundles for plugins that have one, matching
    # forge.config.ts's loop.
    for pluginDir in plugins/*/; do
      if [ -f "$pluginDir/build-main.mjs" ]; then
        ( cd "$pluginDir" && node build-main.mjs )
      fi
    done

    # Stage renderer + main-process bundles into apps/electron/bundled-plugins/
    # + bundled-main-plugins/, filtered by the registry's bundled/voidenVersion
    # fields, and snapshot extensions.json — mirrors forge.config.ts's
    # generateAssets staging logic (see scripts/stage-bundled-plugins.mjs).
    node scripts/stage-bundled-plugins.mjs

    # Compiles assets offline. We run our custom 'build:nix' script (which
    # uses esbuild to bundle and run Vite compilation programmatically)
    # instead of 'package' to avoid triggering Electron Forge's network downloads.
    yarn workspace voiden build:nix

    # Electron Forge's own packager prunes devDependencies before packaging —
    # that pruning never happened here, so every build/CI-only tool
    # (electron-builder's app-builder-bin, aws-sdk for S3 release publishing,
    # typescript, eslint, vite itself, node-gyp, @types/*, ...) was shipping
    # inside node_modules alongside the app. Pure-JS runtime packages that are
    # *also* listed under devDependencies (electron-updater, dotenv, semver,
    # undici) are safe to drop too — esbuild/Vite already bundled them
    # directly into the compiled main.js (see vite.base.config.ts's `external`
    # list: only real "dependencies" entries + native modules are left as
    # actual requires). Runs after build:nix, which still needs the full
    # devDependency set to execute; offline-safe since every production
    # package was already fetched into .yarn/cache during configurePhase.
    #
    # Scoped to the "voiden" (apps/electron) workspace specifically, not
    # --all: apps/ui's entire "dependencies" list (Tiptap, Radix UI,
    # Stoplight, react-icons, ...) is real/correctly-classified from npm's
    # perspective, but Vite's renderer build already compiled all of it into
    # static .vite/renderer/main_window/*.js — the running app loads that
    # bundle via loadFile(), it never requires() apps/ui's source packages
    # from node_modules again. --all would keep them alive for no reason.
    yarn workspaces focus --production voiden

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/voiden $out/bin

    # Copy the built workspace (including native modules and compiled .vite assets) to the store
    cp -r . $out/share/voiden/

    # .yarn/ is yarn's offline package cache/mirror (every dependency tarball
    # fetched during configurePhase) — a build-time-only input the running app
    # never reads. Left in place it was ~1.1GB, nearly half the package's
    # installed size. Safe to drop post-build; node_modules (the actual
    # runtime deps) is untouched.
    rm -rf $out/share/voiden/.yarn

    # plugins/ is the staging area assembled from pinned flake inputs to run
    # scripts/build-plugins.mjs (source + each plugin's own node_modules,
    # ~670MB for 10 plugins) — its only useful output (the built bundles) was
    # already extracted into bundled-plugins/ + bundled-main-plugins/ by
    # scripts/stage-bundled-plugins.mjs earlier in buildPhase. Nothing at
    # runtime reads plugins/ itself.
    rm -rf $out/share/voiden/plugins

    # Wrap the app with Nixpkgs' native Electron package pointing to the apps/electron folder.
    # When Electron starts, it loads apps/electron/package.json which runs the main bundle.
    makeWrapper ${electron}/bin/electron $out/bin/voiden \
      --add-flags "$out/share/voiden/apps/electron" \
      --prefix PATH : ${lib.makeBinPath [ git nodejs_22 ]}

    runHook postInstall
  '';
})
