# Worker Loader example

This example is proof that `workerd-oxc` output can be loaded manually with Cloudflare Worker Loader / Dynamic Workers.

It is intentionally **not** a core package API. The package does not export Worker Loader helpers, build IDs, module graph tools, bundling, package resolution, or object-module shaping.

The Worker:

1. creates an initialized Oxc instance with `createOxc()`;
2. transforms inline TypeScript Worker source;
3. manually constructs a Worker Loader definition;
4. calls `env.LOADER.get(id, () => definition)`;
5. dispatches to the loaded Worker.

```sh
wrangler dev --config examples/worker-loader/wrangler.jsonc
```
