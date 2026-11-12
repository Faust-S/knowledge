import { mountT3App } from "./mount-t3-app";

// Default public domain boot keeps its original inherited T2/T3 behavior.
// A trusted signed-Control distribution compiles its OWN entry that imports
// the exact same mountT3App function with existing private owner callbacks.
// Neither route creates a second Host, Kernel, Store or React root.
const target = document.getElementById("root");
if (!target) throw new Error("T3_HOST_MOUNT_ROOT_REQUIRED");
mountT3App(target);
