// ============================================
// RAG Vector Builder (Chroma Server + Ollama)
// ============================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import unzipper from "unzipper";

import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChromaClient } from "chromadb";

// --------------------------------------------
// 1. PATH SETUP
// --------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsPath = path.join(__dirname, "downloaded_files");

console.log("Loading documents from:", docsPath);

// --------------------------------------------
// 2. LOAD PDFs, DOCX, PPTX
// --------------------------------------------
async function loadAllDocs(dir) {
  const files = fs.readdirSync(dir);
  const docs = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const nested = await loadAllDocs(filePath);
      docs.push(...nested);
      continue;
    }

    // PDF
    if (file.endsWith(".pdf")) {
      try {
        const loader = new PDFLoader(filePath);
        const pages = await loader.load();
        pages.forEach((p) => docs.push({ text: p.pageContent, name: file }));
      } catch (e) {
        console.log("Skipping PDF (corrupt):", file);
      }
      continue;
    }

    // DOCX
    if (file.endsWith(".docx")) {
      try {
        const loader = new DocxLoader(filePath);
        const pages = await loader.load();
        pages.forEach((p) => docs.push({ text: p.pageContent, name: file }));
      } catch (e) {
        console.log("Skipping corrupted DOCX:", file);
      }
      continue;
    }

    // PPTX
    if (file.endsWith(".pptx")) {
      try {
        const zip = await unzipper.Open.file(filePath);
        let text = "";

        for (const entry of zip.files) {
          if (entry.path.includes("ppt/slides/") && entry.path.endsWith(".xml")) {
            const xml = (await entry.buffer()).toString();
            const matches = xml.match(/<a:t>(.*?)<\/a:t>/g);
            if (matches) {
              for (const m of matches) text += m.replace("<a:t>", "").replace("</a:t>", "") + "\n";
            }
          }
        }

        docs.push({ text, name: file });
      } catch (e) {
        console.log("Skipping PPTX:", file);
      }
      continue;
    }

    console.log("Skipping unsupported:", file);
  }

  return docs;
}

const rawDocs = await loadAllDocs(docsPath);
console.log(`Loaded ${rawDocs.length} valid documents.`);

// --------------------------------------------
// 3. CHUNKING
// --------------------------------------------
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

let chunks = [];
let id = 0;

for (const doc of rawDocs) {
  const pieces = await splitter.splitText(doc.text);
  chunks.push(
    ...pieces.map((c) => ({
      id: `chunk_${id++}`,
      text: c,
      source: doc.name,
    }))
  );
}

console.log(`Created ${chunks.length} chunks.`);

// --------------------------------------------
// 4. OLLAMA EMBEDDINGS
// --------------------------------------------
async function embed(text) {
  const resp = await fetch("http://localhost:11434/api/embeddings", {
    method: "POST",
    body: JSON.stringify({
      model: "nomic-embed-text",
      prompt: text,
    }),
  });

  const data = await resp.json();
  return data.embedding;
}

// Embedding batch function (Chroma requires this)
async function embeddingFunction(texts) {
  const output = [];
  for (const t of texts) {
    const v = await embed(t);
    output.push(v);
  }
  return output;
}

console.log("Generating embeddings using Ollama...");

for (let i = 0; i < chunks.length; i++) {
  chunks[i].embedding = await embed(chunks[i].text);
}

console.log("Embeddings generated.");

// --------------------------------------------
// 5. SAVE TO CHROMA SERVER
// --------------------------------------------
console.log("Connecting to Chroma Server...");

const client = new ChromaClient({
  host: "localhost",
  port: 8000,
});

const collection = await client.getOrCreateCollection({
  name: "rag_docs",
  embeddingFunction: embeddingFunction,  // IMPORTANT
});

console.log("Saving vectors to Chroma...");

await collection.add({
  ids: chunks.map((c) => c.id),
  embeddings: chunks.map((c) => c.embedding),
  documents: chunks.map((c) => c.text),
  metadatas: chunks.map((c) => ({ source: c.source })),
});

console.log("Vector DB built successfully.");
