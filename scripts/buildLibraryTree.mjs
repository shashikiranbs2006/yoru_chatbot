// scripts/buildLibraryTree.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// INPUT / OUTPUT FILES
const INPUT_PATH = path.join(__dirname, "../file_index.json");
const OUTPUT_PATH = path.join(__dirname, "../data/libraryTree.json");

// ---------- CORE LOGIC ----------
function buildLibraryTree(flatMap) {
  const tree = {}; // top-level: name -> node

  for (const [fullPath, link] of Object.entries(flatMap)) {
    if (!fullPath) continue;

    const parts = fullPath
      .split("/")
      .map(p => p.trim())
      .filter(Boolean);

    if (parts.length === 0) continue;

    let currentChildren = tree;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;

      if (isFile) {
        // file node
        if (!currentChildren[part]) {
          currentChildren[part] = {
            type: "file",
            name: part,
            link
          };
        } else {
          // if already exists, just ensure link is set
          currentChildren[part].type = "file";
          currentChildren[part].link = link;
        }
      } else {
        // folder node
        if (!currentChildren[part]) {
          currentChildren[part] = {
            type: "folder",
            name: part,
            children: {}
          };
        }
        // go one level deeper
        currentChildren = currentChildren[part].children;
      }
    });
  }

  return tree;
}

// ---------- RUN SCRIPT ----------
function main() {
  console.log("Reading flat resources from:", INPUT_PATH);
  const raw = fs.readFileSync(INPUT_PATH, "utf8");
  const flatJson = JSON.parse(raw);

  const tree = buildLibraryTree(flatJson);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(tree, null, 2), "utf8");
  console.log("Library tree written to:", OUTPUT_PATH);
}

main();
