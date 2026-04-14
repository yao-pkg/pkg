# Output & debug

## Output

You may specify `--output` if you create only one executable, or `--out-path` to place executables for multiple targets into a directory.

## Debug

Pass `--debug` to `pkg` to get a log of the packaging process. If you have issues with a particular file (seems not packaged into the executable), it may be useful to look through the log.

To get more detailed logs on startup, after packaging with `--debug`, start your application with the environment variable `DEBUG_PKG` set to `1` or `2` for more verbose debugging. This loads `prelude/diagnostic.js`, which prints the snapshot tree and the symlink table. With `DEBUG_PKG=2` it also mocks `fs` to print logs when a method is called.

This is useful to see what's included in your bundle and detect missing or unnecessarily large files.

You can also use `SIZE_LIMIT_PKG` and `FOLDER_LIMIT_PKG` to print files and folders larger than the specified size limit (in bytes). The default size limit is 5 MB for files and 10 MB for folders.

See also [Exploring virtual filesystem in debug mode](/guide/advanced-debug-vfs).
