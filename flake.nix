{
  description = "Voiden API Workspace";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Core plugin repos + the registry that lists them (see cleanup.sh / forge.config.ts's
    # generateAssets hook, which do the equivalent via live `git clone` + `npm install` —
    # not reproducible/hermetic, so not usable as-is inside a Nix build). Pinned here as
    # flake inputs instead so `bundled-plugins`/`bundled-main-plugins` can be populated
    # hermetically. Bump these revs when a plugin ships a new version; the plugin's own
    # npmDepsHash (nix/plugins.nix) only needs updating if its package-lock.json changed.
    plugin-registry = { url = "github:VoidenHQ/plugin-registry"; flake = false; };
    plugin-md-preview = { url = "github:VoidenHQ/plugin-md-preview"; flake = false; };
    plugin-openapi-import = { url = "github:VoidenHQ/plugin-openapi-import"; flake = false; };
    plugin-postman-import = { url = "github:VoidenHQ/plugin-postman-import"; flake = false; };
    plugin-simple-assertions = { url = "github:VoidenHQ/plugin-simple-assertions"; flake = false; };
    plugin-voiden-advanced-auth = { url = "github:VoidenHQ/plugin-voiden-advanced-auth"; flake = false; };
    plugin-voiden-faker = { url = "github:VoidenHQ/plugin-voiden-faker"; flake = false; };
    plugin-voiden-graphql = { url = "github:VoidenHQ/plugin-voiden-graphql"; flake = false; };
    plugin-voiden-rest-api = { url = "github:VoidenHQ/plugin-voiden-rest-api"; flake = false; };
    plugin-voiden-scripting = { url = "github:VoidenHQ/plugin-voiden-scripting"; flake = false; };
    plugin-voiden-sockets = { url = "github:VoidenHQ/plugin-voiden-sockets"; flake = false; };
    plugin-voiden-stitch = { url = "github:VoidenHQ/plugin-voiden-stitch"; flake = false; };
  };

  # Advertises the "voiden" Cachix binary cache CI pushes to (see
  # release-package-managers.yml's publish-nix-cache job) so `nix build` /
  # `nix run` / `nix profile install` substitute a prebuilt result instead of
  # compiling Electron + native modules from source. Nix will prompt on first
  # use to trust these settings (or apply them automatically with
  # `--accept-flake-config` / `accept-flake-config = true` in nix.conf) —
  # building from source remains the fallback for anyone who declines, or for
  # architectures/commits the cache hasn't built yet.
  nixConfig = {
    extra-substituters = [ "https://voiden.cachix.org" ];
    extra-trusted-public-keys = [ "voiden.cachix.org-1:oicDzkVuCUndtPka0//GubVRAQGe6XZ6LzZ11nVfknE=" ];
  };

  outputs = { self, nixpkgs, plugin-registry, plugin-md-preview, plugin-openapi-import
            , plugin-postman-import, plugin-simple-assertions, plugin-voiden-advanced-auth
            , plugin-voiden-faker, plugin-voiden-graphql, plugin-voiden-rest-api
            , plugin-voiden-scripting, plugin-voiden-sockets, plugin-voiden-stitch
            }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f system);

      # Maps each plugin's registry `id` (the directory name build-plugins.mjs /
      # forge.config.ts's staging logic expects under plugins/<id>/) to its pinned source.
      pluginSources = {
        md-preview = plugin-md-preview;
        openapi-import = plugin-openapi-import;
        postman-import = plugin-postman-import;
        simple-assertions = plugin-simple-assertions;
        voiden-advanced-auth = plugin-voiden-advanced-auth;
        voiden-faker = plugin-voiden-faker;
        voiden-graphql = plugin-voiden-graphql;
        voiden-rest-api = plugin-voiden-rest-api;
        voiden-scripting = plugin-voiden-scripting;
        voiden-sockets-grpcs = plugin-voiden-sockets;
        voiden-stitch = plugin-voiden-stitch;
      };
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_22
              corepack_22
              git
              python3
            ] ++ lib.optionals stdenv.isLinux [
              pkg-config
            ];

            shellHook = ''
              export PATH="$PATH:$(pwd)/node_modules/.bin"
              mkdir -p .local/bin
              corepack enable --install-directory .local/bin
              export PATH="$(pwd)/.local/bin:$PATH"
              echo "========================================="
              echo " Voiden Development Shell Active"
              echo " Node: $(node --version)"
              echo " Yarn: $(yarn --version)"
              echo "========================================="
            '';
          };
        });

      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          voiden = pkgs.callPackage ./nix/package.nix { inherit pluginSources; pluginRegistrySrc = plugin-registry; };
          default = self.packages.${system}.voiden;
        });
    };
}
