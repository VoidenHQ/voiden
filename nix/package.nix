{ pkgs, lib, stdenv, makeWrapper, electron, git, nodejs_22, python3, libtool }:

let
  # Force yarnProject to build with Node 22. This matches the devShell
  # and avoids V8 API incompatibilities in dependencies (like macos-alias)
  # that occur under newer Node 24 versions.
  yarnProject = pkgs.callPackage ../yarn-project.nix {
    nodejs = nodejs_22;
  } {
    src = lib.cleanSource ../.;
  };
in
yarnProject.overrideAttrs (oldAttrs: {
  name = "voiden";

  # Bypasses the postinstall download step of the electron NPM module
  # which would fail inside the network-disabled sandbox environment.
  ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

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
