import fs from "node:fs";

const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  if (String(file) === process.argv[2]) {
    process.stderr.write("checker-reading\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  return readFileSync.call(this, file, ...args);
};
