import fs from "fs";

const chunks = JSON.parse(fs.readFileSync("stage2_chunks/chunks.json", "utf8"));
const embeds = JSON.parse(fs.readFileSync("stage3_embeddings2/embeddings.json", "utf8"));

if (chunks.length !== embeds.length) {
  console.log("ERROR: chunks and embeddings count differ.");
  console.log("Chunks:", chunks.length, "Embeddings:", embeds.length);
  process.exit(1);
}

const ids = [];
const documents = [];
const metadatas = [];
const embeddings = [];

for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  const e = embeds[i];

  ids.push(String(c.id));
  documents.push(c.content);
  metadatas.push({
    source: c.source,
    chunk_id: c.chunk_id,
    doc_index: c.doc_index
  });
  embeddings.push(e.embedding);
}

fs.writeFileSync(
  "stage3_embeddings2/embeddings_v2.json",
  JSON.stringify({ ids, documents, metadatas, embeddings }, null, 2)
);

console.log("✔ Converted to embeddings_v2.json");
