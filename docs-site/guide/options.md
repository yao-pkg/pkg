# Options

Node.js applications can be called with runtime options (belonging to Node.js or V8). To list them, type `node --help` or `node --v8-options`.

You can **bake** these runtime options into the packaged application. The app will always run with the options turned on. Just drop `--` from the option name.

You can specify multiple options by joining them in a single string, comma (`,`) separated:

```sh
pkg app.js --options expose-gc
pkg app.js --options max_old_space_size=4096
pkg app.js --options max-old-space-size=1024,tls-min-v1.0,expose-gc
```
