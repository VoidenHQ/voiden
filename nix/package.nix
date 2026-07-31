{ pkgs, lib, stdenv, makeWrapper, electron, git, nodejs_22, python3, libtool, fetchurl }:

let
  # Force yarnProject to build with Node 22. This matches the devShell
  # and avoids V8 API incompatibilities in dependencies (like macos-alias)
  # that occur under newer Node 24 versions.
  yarnProject = pkgs.callPackage ../yarn-project.nix {
    nodejs = nodejs_22;
  } {
    src = lib.cleanSource ../.;
  };

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

    # Compiles assets offline. We run our custom 'build:nix' script (which
    # uses esbuild to bundle and run Vite compilation programmatically)
    # instead of 'package' to avoid triggering Electron Forge's network downloads.
    yarn workspace voiden build:nix

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/voiden $out/bin

    # Copy the built workspace (including native modules and compiled .vite assets) to the store
    cp -r . $out/share/voiden/

    # Wrap the app with Nixpkgs' native Electron package pointing to the apps/electron folder.
    # When Electron starts, it loads apps/electron/package.json which runs the main bundle.
    makeWrapper ${electron}/bin/electron $out/bin/voiden \
      --add-flags "$out/share/voiden/apps/electron" \
      --prefix PATH : ${lib.makeBinPath [ git nodejs_22 ]}

    runHook postInstall
  '';
})
