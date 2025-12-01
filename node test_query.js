import { ChromaClient } from "chromadb";

const client = new ChromaClient({ path: "http://localhost:8000" });

const col = await client.getOrCreateCollection({ name: "rag_academic_docs" });

const result = await col.query({
  queryTexts: ["SFH Module 2"],
  nResults: 5,
  include: ["documents"]
});

console.log(result.documents[0]);
