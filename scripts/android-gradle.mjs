// Cross-platform runner del Gradle wrapper del proyecto Android (Capacitor).
// En Windows usa `gradlew.bat`; en Unix/macOS usa `./gradlew`. Evita el bug de
// los npm scripts que invocaban `gradlew` a secas (no resuelve en Windows).
//
// Uso: node scripts/android-gradle.mjs <tarea> [args...]
//   node scripts/android-gradle.mjs bundleRelease
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const androidDir = resolve(here, "..", "android");
const isWin = process.platform === "win32";
// Ruta absoluta al wrapper: con shell:true en Windows, `cmd` resuelve por PATH,
// no por cwd, así que un nombre pelado ("gradlew.bat") no se encuentra.
const wrapper = resolve(androidDir, isWin ? "gradlew.bat" : "gradlew");

const result = spawnSync(wrapper, process.argv.slice(2), {
  cwd: androidDir,
  stdio: "inherit",
  shell: isWin, // el .bat necesita shell en Windows
});

process.exit(result.status ?? 1);
