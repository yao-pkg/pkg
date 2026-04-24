// Decorator syntax forces the walker's Babel parser to enable the
// `decorators-legacy` plugin. Without it pkg would log "Babel parse has
// failed: This experimental syntax requires enabling one of the following
// parser plugin(s)" and silently drop this file's dependency graph. This
// file is walked via `pkg.scripts` but never imported at runtime — Node
// can't execute raw decorator syntax.
function log(Cls) {
  return Cls;
}

@log
export class Widget {
  greet(name) {
    return 'widget:' + name;
  }
}
