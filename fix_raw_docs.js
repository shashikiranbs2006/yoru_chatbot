import fs from "fs";

const raw = JSON.parse(fs.readFileSync("raw_docs_new.json", "utf8"));

const fixed = raw.map(doc => ({
    name: doc.filename,     // convert filename → name
    text: doc.text || ""    // keep text
}));

fs.writeFileSync("raw_docs.json", JSON.stringify(fixed, null, 2));

console.log("Fixed raw_docs.json created.");
