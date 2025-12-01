import { ChromaClient } from "chromadb";

const chroma = new ChromaClient({ host: "localhost", port: 8000 });
const COLLECTION_NAME = "rag_academic_docs";

async function main() {
  try {
    const collection = await chroma.getCollection({ name: COLLECTION_NAME });

    const count = await collection.count();
    console.log("Total entries in Chroma collection:", count);

    const sample = await collection.get({
      include: ["documents"]
    });

    console.log("\nSample texts (first 3):");
    const docs = sample.documents || [];

    docs.slice(0, 3).forEach((text, idx) => {
      const snippet = (text || "").slice(0, 300).replace(/\s+/g, " ");
      console.log(`\n[${idx}] ${snippet}`);
    });

  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
