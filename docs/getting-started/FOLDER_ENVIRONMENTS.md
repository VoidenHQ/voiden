# Folder environment variables

Voiden reads `.env` files along the path to a saved `.void` request. You can keep service-specific values in each service folder without changing the selected workspace environment when switching requests.

```text
workspace/
  .env                 # shared values
  service-a/
    .env               # service A values
    request.void
  service-b/
    .env               # service B values
    request.void
```

For `service-a/request.void`, Voiden combines the workspace `.env`, the selected environment, and `service-a/.env`, in that order. A value defined nearer to the request wins. The service B file does not affect service A requests. A `.void` file in the workspace root uses the selected environment over the root `.env`.

Only files named exactly `.env` in the request's ancestor folders are loaded automatically. Existing named `.env` files and YAML profiles remain available through the environment selector. Keep secret `.env` files out of Git with `.gitignore`.
