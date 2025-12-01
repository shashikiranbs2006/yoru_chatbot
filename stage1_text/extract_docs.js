// Stage 1: Extract text from PDF, DOCX, PPTX (Stable version without pdf-parse)

import fs from "fs";
import path from "path";
import unzipper from "unzipper";
import mammoth from "mammoth";
import { fileURLToPath } from "url";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path: one level up → downloaded_files
const docsPath = path.join(__dirname, "../downloaded_files");
const outputPath = path.join(__dirname, "raw_docs.json");

console.log("Extracting documents...");

// ----------------------------------------------------
// PDF Extraction using pdfjs-dist (NO WORKER REQUIRED)
// ----------------------------------------------------
async function extractPDF(filePath) {
  try {
    const data = new Uint8Array(fs.readFileSync(filePath));

    const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

    let textContent = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const txt = await page.getTextContent();
      for (const item of txt.items) textContent += item.str + " ";
      textContent += "\n";
    }

    return textContent;
  } catch (err) {
    console.log("Skipping corrupted PDF:", path.basename(filePath));
    return "";
  }
}

// ----------------------------------------------------
// DOCX Extraction
// ----------------------------------------------------
async function extractDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch {
    console.log("Skipping corrupted DOCX:", path.basename(filePath));
    return "";
  }
}

// ----------------------------------------------------
// PPTX Extraction (Safe unzip)
// ----------------------------------------------------
async function extractPPTX(filePath) {
  try {
    const directory = await unzipper.Open.file(filePath);
    let pptText = "";

    for (const entry of directory.files) {
      if (
        entry.path.startsWith("ppt/slides/slide") &&
        entry.path.endsWith(".xml")
      ) {
        const xml = (await entry.buffer()).toString();
        const matches = xml.match(/<a:t>(.*?)<\/a:t>/g);
        if (matches) {
          matches.forEach(m => {
            pptText += m.replace("<a:t>", "").replace("</a:t>", "") + "\n";
          });
        }
      }
    }

    return pptText;
  } catch {
    console.log("Skipping corrupted PPTX:", path.basename(filePath));
    return "";
  }
}

// ----------------------------------------------------
// MAIN DOCUMENT LOADER
// ----------------------------------------------------
async function loadDocs(dir) {
  const files = fs.readdirSync(dir);
  const docs = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const nested = await loadDocs(filePath);
      docs.push(...nested);
      continue;
    }

    if (file.endsWith(".pdf")) {
      const text = await extractPDF(filePath);
      docs.push({ name: file, text });
      continue;
    }

    if (file.endsWith(".docx")) {
      const text = await extractDOCX(filePath);
      docs.push({ name: file, text });
      continue;
    }

    if (file.endsWith(".pptx")) {
      const text = await extractPPTX(filePath);
      docs.push({ name: file, text });
      continue;
    }

    console.log("Skipping unsupported:", file);
  }

  return docs;
}

// ----------------------------------------------------
// RUN EXTRACTION
// ----------------------------------------------------
try {
  const docs = await loadDocs(docsPath);

  console.log(`Loaded ${docs.length} documents.`);

  fs.writeFileSync(outputPath, JSON.stringify(docs, null, 2));

  console.log("Extraction complete. Saved to raw_docs.json.");
} catch (err) {
  console.error("Fatal error:", err);
}
