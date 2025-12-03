import fetch from "node-fetch";

const ask = async () => {
  const question = process.argv.slice(2).join(" ");

  if (!question) {
    console.log("Usage: node cli_test.js \"your question\"");
    process.exit(1);
  }

  try {
    const response = await fetch("http://localhost:4000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });

    const data = await response.json();

    console.log("\n========================");
    console.log("QUESTION:");
    console.log(question);

    console.log("\nANSWER:");
    console.log(data.answer || "No answer returned");

    console.log("\nSOURCE FILE:");
    console.log(data.source_label || "No source label");

    console.log("\nSOURCE LINK:");
    console.log(data.source_link || "No source link");

    console.log("========================\n");

  } catch (err) {
    console.error("CLI ERROR:", err.message);
  }
};

ask();
