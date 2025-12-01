import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawDocsPath = path.join(__dirname, "../stage1_text/raw_docs.json");
const outputPath = path.join(__dirname, "chunks.json");

console.log("Loading raw_docs.json...");
const raw = fs.readFileSync(rawDocsPath, "utf8");
const docs = JSON.parse(raw);
console.log(`Loaded ${docs.length} raw documents.`);

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200,
});

let allChunks = [];

// Loop using docIndex to guarantee uniqueness
for (let docIndex = 0; docIndex < docs.length; docIndex++) {
  const doc = docs[docIndex];

  const rawName = doc.name || doc.filename || doc.file || "unknown";
  const cleanName = rawName.toString().split(/[\\/]/).pop();
  const cleanText = typeof doc.text === "string" ? doc.text : "";

  if (cleanText.trim().length === 0) continue;

  const chunks = await splitter.splitText(cleanText);

  chunks.forEach((c, idx) => {
    // 100% unique SHA1: filename + docIndex + chunkIndex + full chunk text
    const uniqueID = crypto
      .createHash("sha1")
      .update(cleanName + docIndex + idx + c)
      .digest("hex");

    allChunks.push({
      id: uniqueID,
      source: cleanName,
      doc_index: docIndex,
      chunk_id: idx,
      content: c
    });
  });
}

console.log(`Created ${allChunks.length} chunks.`);
fs.writeFileSync(outputPath, JSON.stringify(allChunks, null, 2));
console.log("Chunking complete. Saved to chunks.json.");
